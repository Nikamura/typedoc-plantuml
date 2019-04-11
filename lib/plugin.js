var plantuml = require("node-plantuml");
var path = require("path");
var fs = require("fs");
var pako = require("pako");
var encode64 = require("./encode64");
var ProgressBar = require("progress");

function plugin(plugins, pluginEndCallback) {
  var RelativeOutputDirectory = "assets/images";

  // A table with PUml objects
  var PUmlOTable = [];

  var app = plugins.application;

  /**
   *  Given the name, an array of allowed values or a regexp defining allowed
   *   values and a default value this method registers a string option with the
   *   given name, the allowed values as hint and the given default value.
   *  It returns a function, which can be called to get the real value for the
   *   option. If an invalid value is passed, a warning is emmited and the
   *   DefaultValue is returned.
   */
  function stringOption(Name, AllowedValues, DefaultValue) {
    var Help;
    if (AllowedValues.join) Help = AllowedValues.join("|");
    else Help = AllowedValues.toString();
    app.options.addDeclaration({
      name: Name,
      help: AllowedValues,
      defaultValue: DefaultValue
    });
    return function() {
      var Value = app.options.getValue(Name);
      if (AllowedValues.exec && AllowedValues.exec(Value)) return Value;
      if (AllowedValues.indexOf(Value) !== -1) return Value;
      if (Value !== undefined) app.logger.warn("Unknown option specified for " + Name + ": " + Value);
      return DefaultValue;
    };
  }

  /**
   *  Given the name and a default value this method registers a boolean option
   *   with the given name and the given default value.
   *  It returns a function, which can be called to get the real value for the
   *   option. If an invalid value is passed, a warning is emmited and the
   *   DefaultValue is returned.
   */
  function booleanOption(Name, DefaultValue) {
    app.options.addDeclaration({
      name: Name,
      help: "true|false",
      defaultValue: DefaultValue
    });
    return function() {
      var Value = app.options.getValue(Name);
      if (Value === "true" || Value === true) return true;
      if (Value === "false" || Value === false) return false;
      if (Value !== undefined) app.logger.warn("Unknown option specified for " + Name + ": " + Value);
      return DefaultValue;
    };
  }

  /**
   *  Given the name, an array or object:{From:number,To:number} of allowed
   *   values and a default value this method registers a string option with the
   *   given name, the allowed values as hint and the given default value.
   *  It returns a function, which can be called to get the real value for the
   *   option. If an invalid value is passed, a warning is emmited and the
   *   DefaultValue is returned.
   */
  function integerOption(Name, AllowedValues, DefaultValue) {
    var Help = "";
    if (AllowedValues.join) Help = AllowedValues.join("|");
    else
      Help =
        (AllowedValues.From !== undefined ? "[" + AllowedValues.From : "(-∞") +
        "," +
        (AllowedValues.To !== undefined ? AllowedValues.To + "]" : "∞)");
    app.options.addDeclaration({
      name: Name,
      help: Help,
      defaultValue: DefaultValue
    });
    return function() {
      var Value = app.options.getValue(Name);
      if (!((AllowedValues.From && AllowedValues.From > Value) || (AllowedValues.To && AllowedValues.To < Value)))
        return Value;
      if (AllowedValues.indexOf && AllowedValues.indexOf(Value) !== -1) return Value;
      if (Value !== undefined) app.logger.warn("Unknown option specified for " + Name + ": " + Value);
      return DefaultValue;
    };
  }

  //register all options
  var HierarchyOption = stringOption("umlHierarchy", ["none", "simple", "detail", "alldetail"], "simple");
  var ClassicHierarchyOption = stringOption("umlClassicHierarchy", ["none", "before", "behind"], "none");
  var HierarchyDepthUpOption = integerOption("umlHierarchyDepthUp", { From: -1 }, -1);
  var HierarchyDepthDownOption = integerOption("umlHierarchyDepthDown", { From: -1 }, -1);
  var CompleteOption = stringOption("umlComplete", ["none", "simple", "detail"], "none");
  var FormatOption = stringOption("umlFormat", ["png", "svg"], "png");
  var ThreadsOption = integerOption("umlThreads", { From: 1 }, 4);
  var UmlTagOption = booleanOption("umlTag", true);
  var UmlShowInheritedOption = booleanOption("umlShowInheritedOption", false);
  var SeperateClassDetailViewOption = booleanOption("umlSeperateClassDetailView", false);
  //better match too much than too few - the user will notice it if the url is wrong...
  var LocationOption = stringOption("umlLocation", /^local|remote|(?:https?:\/\/)?[^ "]*$/, "local");
  var ShowSpotOption = booleanOption("umlShowSpot", true);
  var VisibilityIconsOption = stringOption("umlVisibilityIcons", ["none", "ascii", "graphic"], "graphic");
  var LinkClassesOption = booleanOption("umlLinkClasses", true);

  //define the variables for the options. They will all be filled in the
  // beginning of the resolveBegin-Callback. They must not be used earlier.
  var Hierarchy;
  var Hierarchy_AllDetail;
  var Hierarchy_Detail;
  var ClassicHierarchy;
  var ClassicHierarchyBefore;
  var ClassicHierarchyBehind;
  var HierarchyDepthUp;
  var HierarchyDepthDown;
  var Complete;
  var CompleteDetail;
  var Format;
  var generateUmlContainerHtml;
  var Extension;
  var Threads;
  var UmlTag;
  var UmlShowInherited;
  var SeperateClassDetailView;
  var LinkClasses;

  var xLocation; //Location is a reserved keyword :(
  var RemoteUrl;

  var PlantOptions;
  var ShowVisibilityIcons;

  //AbsoluteOutputDirectory is assigned in beginRender and must not be used earlier
  // without check.
  var AbsoluteOutputDirectory;

  //DeferredGenerators holds an array of Uml generators, which have been started
  // before beginRender. As AbsoluteOutputDirectory is not set at that time,
  // their function calls are deferred.
  var DeferredGenerators = [];
  //Counts how many generators are currently running
  var RunningGenerators = 0;
  //Counts how many generators need to be executed
  var RemainingGenerators = 0;
  /**
   *  This method must not be called before beginRender. Else it will call the
   *   pluginEndCallback immediately.
   *  If there are any deferred generators, they will be executed and dropped
   *   from the DeferredGenerators array.
   */
  function checkModuleDone() {
    if (DeferredGenerators.length > 0) {
      var l = 0;
      if (Threads) l = Threads - RunningGenerators;
      if (l > DeferredGenerators.length) l = DeferredGenerators.length;
      for (var i = 0; i < l; ++i) {
        //execute a deferred generator. This will increment RunningGenerators.
        DeferredGenerators.pop()();
      }
    } else if (RemainingGenerators == 0 && pluginEndCallback) {
      pluginEndCallback();
    }
  }

  //Originally I planned to directly integrate svg into html, but renderer does
  // not allow asynchronous tasks. Should report a ticket for that. I leave this
  // commented-out function here as reminder.
  // function generateIt(src,pluginEndCallback) {
  // 	var gen = plantuml.generate(src,PlantOptions,pluginEndCallback);
  // 	...
  // }

  //The UmlGeneratorProgressBar is be initialized right at the end in endRender.
  // As some or all generators may already run while typedoc still runs itself,
  //  the progress bar may seem fast in the beginning and slower at the end.
  var UmlGeneratorProgressBar;

  /**
   *  This function generates a link url to a CoI. RelativePath is usually sth.
   *   like '../'. Would be better to find a way to get paths relieably from
   *   typedoc, even forward-lookup ("What will the target link for ID be?")
   */
  function getLinkToCoI(ToPUmlO) {
    var Parts = [];
    var TargetDir = "";
    if (ToPUmlO.Kind === 128 /* Class */) TargetDir = "classes";
    if (ToPUmlO.Kind === 256 /* Interface */) TargetDir = "interfaces";
    return path.join("../..", TargetDir, ToPUmlO.Name + ".html");
  }

  /**
   *  Given a Src (human readable PlantUml string), an ImageName and a RelativePath,
   *   generatePlantUml returns the URL to be included into the markup.
   *  If RemoteURL is set, it encodes Src and returns the remote code. Easy.
   *  If RemoteURL is unset, it checks, whether the AbsoluteOutputDirectory is
   *   already known (after beginRender). If not, it defers itself. Else it
   *   directly starts plantUml to generate the target image into the given
   *   output directory.
   *   Finally it returns the relative path, prepended by the given RelativePath.
   *   Hint: Usually something like '../' is passed in for pages, which are not
   *   in the websites root directory. If typedoc changes its placement strategy,
   *   this aproach may fail. However, for performance reasons it is much better
   *   to integrate the correct url directly into the markup, instead of parsing
   *   the whole output html...
   */
  function generatePlantUml(Src, ImageName, RelativePath) {
    Src = "@startuml\n" + Src + "\n@enduml";
    if (RemoteURL !== undefined) {
      return RemoteURL + Format + "/" + encode64.encode(pako.deflate(Src, { level: 9, to: "string" }));
    } else {
      RemainingGenerators++;
      if (AbsoluteOutputDirectory === undefined || RunningGenerators >= Threads) {
        //defer
        DeferredGenerators.push(function() {
          generatePlantUml(Src, ImageName, RelativePath);
        });
      } else {
        //run now
        var ImagePath = path.join(AbsoluteOutputDirectory, ImageName + Extension);
        RunningGenerators++;
        var gen = plantuml.generate(Src, PlantOptions);
        gen.out.pipe(fs.createWriteStream(ImagePath));
        gen.out.on("end", function() {
          RunningGenerators--;
          RemainingGenerators--;
          if (UmlGeneratorProgressBar) UmlGeneratorProgressBar.tick();
          checkModuleDone();
        });
      }
      return path.join(RelativePath, RelativeOutputDirectory, ImageName + Extension);
    }
  }

  /**
   *  This helper function for visitPUmlO iterates over an array of id's,
   *   generates inheritance arrows and recursively invokes visitPUmlO for
   *   all found sub elements.
   */
  function handleExtImplArray(ThisName, ExtImplArray, TargetArrowThis, UpDepth, DownDepth, Visited, Detail) {
    if (ExtImplArray) {
      var PUmls = [];
      for (var i = 0, l = ExtImplArray.length; i < l; ++i) {
        var TargetPUmlO = PUmlOTable[ExtImplArray[i]];
        if (TargetPUmlO) {
          PUmls.push(TargetPUmlO.Name + TargetArrowThis + ThisName);
          //decrease the UpDepth / DownDepth, if not already zero or -1 (= infinite)
          PUmls.push(
            visitPUmlO(
              TargetPUmlO,
              UpDepth > 0 ? UpDepth - 1 : UpDepth,
              DownDepth > 0 ? DownDepth - 1 : DownDepth,
              Visited,
              Detail
            )
          );
        }
      }
      return PUmls.join("\n");
    }
  }

  /**
   *  This helper function for the generators handles one PUml object and
   *   generates PUml code as specified.
   */
  function visitPUmlO(ThisPUmlO, UpDepth, DownDepth, Visited, Detail) {
    var PUmls = [];
    if (ThisPUmlO) {
      var ThisName = ThisPUmlO.Name;
      var ThisPUmlOId = ThisPUmlO.Id;
      //never add a CoI twice.
      if (Visited[ThisPUmlOId]) return "";
      Visited[ThisPUmlOId] = true;
      //Add this element with Details (methods, properties) if requested.
      // else just declare the CoI
      if (Detail !== 0) PUmls.push(ThisPUmlO.PUml);
      else PUmls.push(ThisPUmlO.CoIStr + " " + ThisName);
      //Generate a link for the CoI
      if (LinkClasses) PUmls.push("url of " + ThisName + " is [[" + getLinkToCoI(ThisPUmlO) + "]]");
      //If detail is -1 or 0 keep it as is. With -1 it will show details for all
      // extend/implement CoI, with 0 for none. Decrease it, if it is natural.
      // then this CoI was printed in detail and Detail-1 more levels from
      // this CoI will be shown in detail.
      var ChildrenDetail = Detail > 0 ? Detail - 1 : Detail;
      if (UpDepth !== 0) {
        //only walk up (child -> parent) the extends/implements tree, if...
        // once gone up, never go down from a base type
        PUmls.push(handleExtImplArray(ThisName, ThisPUmlO.Extends, " <|-- ", UpDepth, 0, Visited, ChildrenDetail));
        PUmls.push(handleExtImplArray(ThisName, ThisPUmlO.Implements, " <|.. ", UpDepth, 0, Visited, ChildrenDetail));
      }
      if (DownDepth !== 0) {
        //only walk down (parent -> child) the extends/implements tree, if...
        // once gone up, never go up from a child type
        PUmls.push(handleExtImplArray(ThisName, ThisPUmlO.ExtendedBy, " --|> ", 0, DownDepth, Visited, ChildrenDetail));
        PUmls.push(
          handleExtImplArray(ThisName, ThisPUmlO.ImplementedBy, " ..|> ", 0, DownDepth, Visited, ChildrenDetail)
        );
      }
      return PUmls.join("\n");
    }
  }

  var GeneralPUmlOptions = "";

  /**
   *  This generates the hierarchy diagram for a CoI.
   */
  function getHierarchyPUmlForClass(Id) {
    var ThisPUmlO = PUmlOTable[Id];
    if (ThisPUmlO) {
      var PUmls = [];
      PUmls.push(GeneralPUmlOptions);
      var ThisName = ThisPUmlO.Name;
      //Hide the seperator lines between the empty members / methods of those
      // CoIs without details.
      if (!HierarchyAllDetail) PUmls.push("hide members");
      if (HierarchyDetail) PUmls.push("show " + ThisName + " members");
      //If the CoI of interest shall be shown in detail, add the PUml.
      // else just declare the CoI
      if (Hierarchy_Detail) PUmls.push(ThisPUmlO.PUml);
      else PUmls.push(ThisPUmlO.CoIStr + " " + ThisName);
      //start the recursion with the CoI of interest. Pass the initial hierarchy
      // depths. Pass an empty set of visited CoIs. Pass in, whether the first
      // CoI shall be shown in details and whether the remaining CoIs shall be
      // shown in detail.
      var Detail;
      if (HierarchyAllDetail) Detail = -1;
      else if (HierarchyDetail) Detail = 1;
      else Detail = 0;
      PUmls.push(visitPUmlO(ThisPUmlO, HierarchyDepthUp, HierarchyDepthDown, {}, Detail));
      return PUmls.join("\n");
    }
  }

  /**
   *  This generates a diagram with only the one given class with details.
   *   All extends / implements are hidden.
   */
  function getSeperateDetailedPUmlForClass(Id) {
    var ThisPUmlO = PUmlOTable[Id];
    if (ThisPUmlO) {
      return GeneralPUmlOptions + "\n" + visitPUmlO(ThisPUmlO, 0, 0, {}, 1);
    }
  }

  /**
   *  This generates a complete PUml diagram with all classes and interfaces.
   *   Details are shown depending on the complete-Option.
   */
  function getCompletePUml() {
    var PUmlClassIds = Object.keys(PUmlOTable);
    var PUmls = [];
    PUmls.push(GeneralPUmlOptions);
    if (!CompleteDetail) PUmls.push("hide members");
    //iterate over all CoI
    for (var i = 0, l = PUmlClassIds.length; i < l; ++i) {
      var PUmlO = PUmlOTable[PUmlClassIds[i]];
      PUmls.push(visitPUmlO(PUmlO, 1, 0, {}, CompleteDetail ? 1 : 0));
    }
    return PUmls.join("\n");
  }

  app.converter.on("resolveBegin", function(context) {
    Hierarchy = HierarchyOption();
    HierarchyAllDetail = Hierarchy === "alldetail";
    HierarchyDetail = HierarchyAllDetail || Hierarchy === "detail";
    Hierarchy = HierarchyDetail || Hierarchy === "simple";
    ClassicHierarchy = ClassicHierarchyOption();
    ClassicHierarchyBefore = ClassicHierarchy === "before";
    ClassicHierarchyBehind = ClassicHierarchy === "behind";
    ClassicHierarchy = ClassicHierarchyBefore || ClassicHierarchyBehind;
    HierarchyDepthUp = HierarchyDepthUpOption();
    HierarchyDepthDown = HierarchyDepthDownOption();
    Complete = CompleteOption();
    CompleteDetail = Complete === "detail";
    Complete = CompleteDetail || Complete === "simple";
    Format = FormatOption();
    Extension = "." + Format;
    Threads = ThreadsOption();
    UmlTag = UmlTagOption();
    UmlShowInherited = UmlShowInheritedOption();
    SeperateClassDetailView = SeperateClassDetailViewOption();
    LinkClasses = LinkClassesOption();
    PlantOptions = { format: Format, nbthread: Threads };

    (function() {
      var xLocation = LocationOption();
      //get the remote URL right, if needed...
      if (xLocation === "remote") RemoteURL = "http://www.plantuml.com/plantuml/";
      else if (xLocation === "local") RemoteURL = undefined;
      else RemoteURL = xLocation;
    })();

    GeneralPUmlOptions = (function() {
      //Handle general PUml class diagram options
      var ShowSpot = ShowSpotOption();
      var VisibilityIcons = VisibilityIconsOption();
      var PUmls = [];
      if (!ShowSpot) PUmls.push("hide circle");
      if (VisibilityIcons === "none") ShowVisibilityIcons = false;
      else ShowVisibilityIcons = true;
      if (VisibilityIcons === "ascii") PUmls.push("skinparam classAttributeIconSize 0");
      return PUmls.join("\n");
    })();

    //This variable holds, whether any option requires member details to be generated.
    var NeedsDetailPUml = HierarchyDetail || CompleteDetail || SeperateClassDetailView;
    if (!NeedsDetailPUml) app.logger.log("Skipping detailed PlantUml-Generation.");

    //The generated function generates the html view code for a given url.
    //The generator-function uses the Format-Option to pregenerate reused strings and
    // therefore cannot be generated in "plugin scope", which executes before
    // resolveBegin -> before options can be retrieved.
    generateUmlContainerHtml = (function() {
      var Png = Format === "png";
      var Prefix =
        '<div class="uml-container">' + (Png ? '<a href="' : '<object type="image/svg+xml" class="uml-image" data="');
      var Infix = Png ? '"><img class="uml-image" src="' : '"></object><br /><a href="';
      var Suffix = (Png ? '"></img></a>' : '">Enlarge</a>') + "</div>";
      return function(Url) {
        return Prefix + Url + Infix + Url + Suffix;
      };
    })();

    var project = context.project;

    /**
     *  This converts a tsc-internal id to a typedoc-id.
     */
    function lookupSymbolMapping(symbolId) {
      return project.symbolMapping[symbolId];
    }

    function handleTypeArgument(TypeArgument) {
      //TODO
    }

    function handleTypeArguments(TypeArgumens) {
      //TODO
      return "";
    }

    function handleType(Type) {
      if (Type) {
        // TODO
        // IntrinsicType
        // ReferenceType
        // ReflectionType
        // StringLiteralType
        // TupleType
        // TypeParameterType
        // UnionType
        // UnknownType
        if (Type.name) {
          return Type.name + handleTypeArguments(Type.typeArguments);
        }
      }
      return "";
    }

    function handleTypeParameter(TypeParameter) {
      //TODO
    }

    function handleTypeParameters(TypeParameters) {
      //TODO
      return "";
    }

    function handleParameter(Parameter) {
      return Parameter.name + " : " + handleType(Parameter.type);
    }

    function handleParameters(Parameters) {
      if (Parameters) {
        var l = Parameters.length;
        var PUmls = new Array(l);
        for (var i = 0; i < l; ++i) {
          PUmls[i] = handleParameter(Parameters[i]);
        }
        return PUmls.join(",");
      }
      return "";
    }

    function handleSignature(Signature) {
      var PUml = "";
      //TODO: further signature types
      if (Signature.kind === 4096 /* CallSignature */) {
        PUml =
          handleTypeParameters(Signature.typeParameters) +
          "(" +
          handleParameters(Signature.parameters) +
          ")" +
          " : " +
          handleType(Signature.type);
      }
      return PUml;
    }

    function handleSignatures(Signatures) {
      var PUml = "";
      if (Signatures) {
        for (var i = 0, l = Signatures.length; i < l; ++i) {
          PUml = PUml + handleSignature(Signatures[i]);
        }
      }
      return PUml;
    }

    function handleClassOrInterfaceMember(Member) {
      if (UmlShowInherited === false && Member.inheritedFrom !== undefined) return "";
      //TODO: ShowVisibilityIcons
      var PUml = "";
      if (Member.kind === 1024 /* Property */) {
        PUml = Member.name + " : " + handleType(Member.type);
      } else if (Member.kind === 2048 /* Method */) {
        PUml = Member.name + handleSignatures(Member.signatures);
      }
      //TODO: further member types
      return PUml;
    }

    /**
     *  Iterate over all members in the CoI and collect their PUml data.
     */
    function handleClassOrInterfaceMembers(Members) {
      if (Members) {
        var l = Members.length;
        var PUmls = new Array(l);
        for (var i = 0; i < l; ++i) {
          PUmls[i] = handleClassOrInterfaceMember(Members[i]);
        }
        return PUmls.join("\n");
      }
      return "";
    }

    /**
     *  Handles an array of extends, extendedby, implements or implementedby.
     *   Basically just generates an array of Ids, which is the only interesting
     *   information here.
     */
    function handleExtImplArray(ExtImplArray) {
      if (ExtImplArray) {
        var ExtImplIds = new Array(ExtImplArray.length);
        for (var i = 0, l = ExtImplArray.length; i < l; ++i) {
          var ExtImpl = ExtImplArray[i];
          ExtImplIds[i] = lookupSymbolMapping(ExtImpl.symbolID);
        }
        return ExtImplIds;
      }
    }

    function handleClassOrInterface(CoI) {
      // CoI <= "ClassOrInterface"
      var PUml = "";
      //where to find "abstract"???
      var CoIStr = "";
      if (CoI.kind === 128 /* Class */) CoIStr = "class";
      else if (CoI.kind === 256 /* Interface */) CoIStr = "interface";
      else app.logger.writeln("Do not know how to generate a class diagram for " + CoI.name);
      PUml =
        CoIStr + " " + CoI.name + (NeedsDetailPUml ? " {\n" + handleClassOrInterfaceMembers(CoI.children) + "\n}" : "");
      // store the information needed for generating the uml diagram with the
      //  typedoc-Id in a map. Once finished, that map will contain an entry for
      //  each Class and Interface.
      return {
        Id: CoI.id,
        CoIStr: CoIStr,
        Kind: CoI.kind,
        Name: CoI.name,
        PUml: PUml,
        Extends: handleExtImplArray(CoI.extendedTypes),
        ExtendedBy: handleExtImplArray(CoI.extendedBy),
        Implements: handleExtImplArray(CoI.implementedTypes),
        ImplementedBy: handleExtImplArray(CoI.implementedBy)
      };
    }
    // go though all the reflections
    for (var key in project.reflections) {
      var reflection = project.reflections[key];
      // For Class and Interface generate a class diagram
      if (reflection.kind === 128 /* Class */ || reflection.kind === 256 /* Interface */) {
        var PUmlO = handleClassOrInterface(reflection);
        PUmlOTable[PUmlO.Id] = PUmlO;
      }
      if (UmlTag && reflection.comment) {
        // search in comments for uml tags and replace them with a local or remote
        // url. in case of local, start the generator task in background.
        reflection.comment.shortText = processComment(reflection.comment.shortText);
        reflection.comment.text = processComment(reflection.comment.text);
      }
    }
  });

  var umlExpression = /<uml(?:\s+alt\s*=\s*['"](.+)['"]\s*)?>([\s\S]*?)<\/uml>/gi;
  var CommentId = 0;
  function processComment(text) {
    var match,
      index = 0,
      segments = [],
      tmpUmlStringArray = [],
      tmpIncludePath = "",
      opLocation = LocationOption();

    // if we have comment body text look for uml blocks
    if (text) {
      while ((match = umlExpression.exec(text)) != null) {
        segments.push(text.substring(index, match.index));
        // uml data used include and use remote. replace uml data to inclued file.
        if (opLocation === "remote" && match[2].indexOf("!include") !== -1) {
          tmpUmlStringArray = match[2].split("\n");

          for (var i = 0, len = tmpUmlStringArray.length; i < len; i++) {
            tmpIncludePath = tmpUmlStringArray[i].replace("!include ", "");
            if (tmpUmlStringArray[i].indexOf("!include") !== -1) {
              var importPath = path.join(process.cwd(), tmpIncludePath);
              if (fs.statSync(importPath).isFile()) {
                var data = fs.readFileSync(importPath, "utf8");
                match[2] = match[2].replace(tmpUmlStringArray[i], data);
              }
            }
          }
        }
        // replace the uml block with the image link, which will later be generated.
        if (match[2]) {
          segments.push("![");
          if (match[1]) {
            // alternate text
            segments.push(match[1]);
          }
          //already start generating the uml image
          var Url = generatePlantUml(match[2], CommentId, "../");
          segments.push("](" + Url + ")");
        }
        index = match.index + match[0].length;
      }
      // write modified comment back
      if (segments.length > 0) {
        segments.push(text.substring(index, text.length));
        return segments.join("");
      }
    }
    return text;
  }

  app.renderer.on("beginRender", function(event) {
    // get the output directory
    // this also notifies, that the rendering stage has begun - from now on, images can be stored.
    AbsoluteOutputDirectory = path.join(event.outputDirectory, RelativeOutputDirectory);
  });

  var IndexPageMatcher = /index\.html/;
  app.renderer.on("endPage", function(page) {
    if (Complete && IndexPageMatcher.exec(page.url)) {
      //If it is the index page, insert complete class diagram on top
      var Contents = page.contents;
      if (Contents) {
        var InsertMatcher = /<div class="container container-main">[^]*?<div class="col-8 col-content">/;
        var Match = InsertMatcher.exec(Contents);
        if (Match) {
          //insert it behind the col-8-opening div tag.
          var InsertPosition = Match.index + Match[0].length;
          var CompletePUml = getCompletePUml();
          var Url = generatePlantUml(CompletePUml, "CompleteClassDiagram", "");
          page.contents =
            Contents.substring(0, InsertPosition) +
            '<div class="tsd-panel"><h3>Class Diagram</h3>' +
            generateUmlContainerHtml(Url) +
            "</div>" +
            Contents.substring(InsertPosition);
        }
      }
      //There is at most one index page.
      Complete = false;
    }
    if (Hierarchy || !ClassicHierarchy) {
      //a hierarchy shall be generated or the classic hierarchy shall be removed
      var Contents = page.contents;
      var Model = page.model;
      var ModelID = Model.id;
      var ModelName = Model.name;
      if (Contents) {
        var HierarchyRegex = /(<section class="tsd-panel tsd-hierarchy">[^]*?<h3>Hierarchy<\/h3>[^]*?<\/section>)/;
        var Match = HierarchyRegex.exec(Contents);
        if (Match) {
          //get the string indices before and after the classic hierarchy
          var MatchIndex = Match.index;
          var MatchEndIndex = MatchIndex + Match[0].length;
          var UmlHierarchy = "";
          if (Hierarchy) {
            //generate the class hierarchy
            var HierarchyPUml = getHierarchyPUmlForClass(ModelID);
            if (HierarchyPUml) {
              var Url = generatePlantUml(HierarchyPUml, ModelName, "../");
              UmlHierarchy = generateUmlContainerHtml(Url);
            }
          }
          var DetailedClassBox = "";
          if (SeperateClassDetailView) {
            //generate the detailed class box
            var DetailedClassBoxUml = getSeperateDetailedPUmlForClass(ModelID);
            var Url = generatePlantUml(DetailedClassBoxUml, ModelName + ".details", "../");
            DetailedClassBox =
              '<section class="tsd-panel"><h3>Class Details</h3>' + generateUmlContainerHtml(Url) + "</section>";
          }
          //insert the uml hierarchy before or after the classic hierarchy.
          //DetailedClassBox is always inserted behind all hierarchy containers.
          var ClassicHierarchyView = Match[1];
          var GraphicHierarchyView =
            '<section class="tsd-panel tsd-hierarchy"><h3>Hierarchy-Diagram</h3>' + UmlHierarchy + "</section>";
          page.contents =
            Contents.substring(0, MatchIndex) +
            (ClassicHierarchyBefore
              ? ClassicHierarchyView + GraphicHierarchyView
              : GraphicHierarchyView + ClassicHierarchyView) +
            DetailedClassBox +
            Contents.substring(MatchEndIndex);
        }
      }
    }
  });

  app.renderer.on("endRender", function(event) {
    // start another ProgressBar for the asynchronous PlantUml threads
    if (RemoteURL === undefined) {
      UmlGeneratorProgressBar = new ProgressBar("Generating UML [:bar] :percent", {
        total: RemainingGenerators + 1,
        width: 40
      });
    }
    // append styles to main.css
    var filename = path.join(event.outputDirectory, "assets/css/main.css");
    fs.appendFileSync(
      filename,
      "\n.uml-container { max-width: 100%; text-align: center; }" +
        "\n.uml-container > .uml-image { max-width: 100%; }\n"
    );
    //this is the one tick, if there was a new progress bar.
    if (UmlGeneratorProgressBar) UmlGeneratorProgressBar.tick();
    //Finally call checkModuleDone for two reasons:
    // 1. there may be deferred generators waiting.
    // 2. if not, pluginEndCallback still needs to be called.
    setTimeout(checkModuleDone, 0);
  });
}

module.exports = plugin;
