var plantuml = require("node-plantuml");
var path = require("path");
var fs = require("fs");
var pako = require("pako");
var encode64 = require("./encode64");
var ProgressBar = require("progress");

function plugin (plugins, cb) {

		var encodedUmlExpression = /<img src="http:\/\/www.plantuml.com\/plantuml\/(?:img|png|svg)\/([^"]*)"(?: alt="(.*)")?>/g,
				RelativeOutputDirectory = 'assets/images',
				server = "http://www.plantuml.com/plantuml/",
				format,
				location;

		var PUmlOTable = [];
		var RemainingPlanters = 0;

		var app = plugins.application;

		function stringOption(Name,AllowedValues,DefaultValue) {
			app.options.addDeclaration({
				name:Name,
				help:AllowedValues.join('|'),
				defaultValue:DefaultValue
			});
			return function(){
				var Value = app.options.getValue(Name);
				if (AllowedValues.indexOf(Value) !== -1) return Value;
				return DefaultValue;
			};
		}

		function booleanOption(Name,DefaultValue) {
			app.options.addDeclaration({
				name:Name,
				help:'true|false',
				defaultValue:DefaultValue
			});
			return function(){
				var Value = app.options.getValue(Name);
				if (Value === undefined) return DefaultValue;
				return Value === 'true';
			};
		}

		function integerOption(Name,AllowedValues,DefaultValue) {
			var Help = '';
			if (AllowedValues.join) Help = AllowedValues.join('|');
			else Help = ((AllowedValues.From !== undefined)?('[' + AllowedValues.From):'(-∞') + ',' + ((AllowedValues.To !== undefined)?(AllowedValues.To + ']'):'∞)');
			app.options.addDeclaration({
				name:Name,
				help:Help,
				defaultValue:DefaultValue
			});
			return function() {
				var Value = app.options.getValue(Name);
				if (!((AllowedValues.From && AllowedValues.From > Value) || (AllowedValues.To && AllowedValues.To < Value))) return Value;
				if (AllowedValues.indexOf && AllowedValues.indexOf(Value) !== -1) return Value;
				return DefaultValue;
			};
		}

		var HierarchyOption =                stringOption('umlHierarchy',['none','simple','detail','alldetail'],'simple');
		var ClassicHierarchyOption =         stringOption('umlClassicHierarchy',['none','before','behind'],'none');
		var HierarchyDepthUpOption =        integerOption('umlHierarchyDepthUp',{From:-1},-1);
		var HierarchyDepthDownOption =      integerOption('umlHierarchyDepthDown',{From:-1},-1);
		var CompleteOption =                 stringOption('umlComplete',['none','simple','detail'],'none');
		var FormatOption =                   stringOption('umlFormat',['png','svg'],'png');
		var ThreadsOption =                 integerOption('umlThreads',{From:1},4);
		var UmlTagOption =                  booleanOption('umlTag',true);
		var RemoteOption =                  booleanOption('umlRemote',false);

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
		var implantImg;
		var Extension;
		var Threads;
		var UmlTag;
		var Remote;
		var AbsoluteOutputDirectory;

		var PlantOptions = {format:'svg'};

		var RenderingStage = false;
		var DeferredPlanters = [];

		function checkModuleDone() {
			if (DeferredPlanters.length > 0) {
				for (var i = 0,l = DeferredPlanters.length;i<l;++i) {
					DeferredPlanters[i]();
				}
				DeferredPlanters.length = 0;
			} else if (RenderingStage && RemainingPlanters == 0 && cb) {
				cb();
			}
		}

		//planned to directly integrate svg into html, but renderer does not allow
		// asynchronous tasks. Should report a ticket for that.
		// function plantIt(src,cb) {
		// 	var gen = plantuml.generate(src,PlantOptions,cb);
		// }
		var RemainingPlanters = 0;
		var PlantingProgressBar;
		function generatePlantUml(Src,ImageName,RelativePath) {
			if (Remote) {
				return server + Format + '/' + encode64.encode(pako.deflate(Src, { level: 9, to: 'string' }));
			} else {
				var ImagePath = path.join(AbsoluteOutputDirectory,ImageName + Extension);
				if (RenderingStage === false) {
					DeferredPlanters.push(function(){
						generatePlantUml(Src,ImageName,RelativePath);
					});
				} else {
					RemainingPlanters++;
					var gen = plantuml.generate(Src,PlantOptions);
					gen.out.pipe(fs.createWriteStream(ImagePath));
					gen.out.on('finish',function(){
						RemainingPlanters--;
						if (PlantingProgressBar) PlantingProgressBar.tick();
						checkModuleDone();
					});
				}
				return path.join(RelativePath,RelativeOutputDirectory,ImageName + Extension);
			}
		}

		function handleExtImplArray(ThisName,ExtImplArray,TargetArrowThis,UpDepth,DownDepth,Visited,Detail) {
			if (ExtImplArray) {
				var PUmls = [];
				for (var i=0,l=ExtImplArray.length;i<l;++i) {
					var TargetPUmlO = PUmlOTable[ExtImplArray[i]];
					if (TargetPUmlO) {
						PUmls.push(TargetPUmlO.Name + TargetArrowThis + ThisName);
						PUmls.push(visitPUmlO(TargetPUmlO,(UpDepth>0?UpDepth-1:UpDepth),(DownDepth>0?DownDepth-1:DownDepth),Visited,Detail));
					}
				}
				return PUmls.join('\n');
			}
		}

		function visitPUmlO(ThisPUmlO,UpDepth,DownDepth,Visited,Detail) {
			var PUmls = [];
			if (ThisPUmlO) {
				var ThisPUmlOId = ThisPUmlO.Id;
				if (Visited[ThisPUmlOId]) return '';
				Visited[ThisPUmlOId] = true;
				if (Detail) PUmls.push(ThisPUmlO.PUml);
				else PUmls.push(ThisPUmlO.CoIStr + ' ' + ThisPUmlO.Name);
				var ThisName = ThisPUmlO.Name;
				if (UpDepth !== 0) {
					PUmls.push(handleExtImplArray(ThisName,ThisPUmlO.Extends,' <|-- ',UpDepth,0,Visited,Detail));
					PUmls.push(handleExtImplArray(ThisName,ThisPUmlO.Implements,' <|.. ',UpDepth,0,Visited,Detail));
				}
				if (DownDepth !== 0) {
					PUmls.push(handleExtImplArray(ThisName,ThisPUmlO.ExtendedBy,' --|> ',0,DownDepth,Visited,Detail));
					PUmls.push(handleExtImplArray(ThisName,ThisPUmlO.ImplementedBy,' ..|> ',0,DownDepth,Visited,Detail));
				}
				return PUmls.join('\n');
			}
		}

		function getNeighbourhoodPUmlForClass(Id) {
			if (!Hierarchy) return;
			var ThisPUmlO = PUmlOTable[Id];
			if (ThisPUmlO) {
				var PUmls = [];
				// app.logger.writeln(ThisPUmlO);
				var ThisName = ThisPUmlO.Name;
				if (Hierarchy_Detail) PUmls.push(ThisPUmlO.PUml);
				else PUmls.push(ThisPUmlO.CoIStr + ' ' + ThisName);
				PUmls.push(visitPUmlO(ThisPUmlO,HierarchyDepthUp,HierarchyDepthDown,{},HierarchyAllDetail));
				if (!HierarchyAllDetail) PUmls.push('hide members\nhide methods');
				if (HierarchyDetail) PUmls.push('show ' + ThisName + ' methods\nshow ' + ThisName + ' members');
				return '@startuml\n' + PUmls.join('\n') + '\n@enduml';
			}
		}

		function getCompletePUml() {
			var PUmlClassIds = Object.keys(PUmlOTable);
			var PUmls = [];
			if (!CompleteDetail) PUmls.push('hide members\nhide methods');
			for (var i=0,l=PUmlClassIds.length;i<l;++i) {
				var PUmlO = PUmlOTable[PUmlClassIds[i]];
				PUmls.push(visitPUmlO(PUmlO,1,0,{},CompleteDetail));
			}
			return PUmls.join('\n');
		}

		// on resolve replace uml blocks with image link to encoded uml data
		app.converter.on("resolveBegin", function (context) {
			Hierarchy = HierarchyOption();
			HierarchyAllDetail = Hierarchy === 'alldetail';
			HierarchyDetail = Hierarchy === 'detail' || Hierarchy === 'alldetail';
			Hierarchy = HierarchyDetail || Hierarchy === 'simple';

			ClassicHierarchy = ClassicHierarchyOption();
			ClassicHierarchyBefore = ClassicHierarchy === 'before';
			ClassicHierarchyBehind = ClassicHierarchy === 'behind';
			ClassicHierarchy = ClassicHierarchyBefore || ClassicHierarchyBehind;

			HierarchyDepthUp = HierarchyDepthUpOption();
			HierarchyDepthDown = HierarchyDepthDownOption();

			Complete = CompleteOption();
			CompleteDetail = Complete === 'detail';
			Complete = CompleteDetail || Complete === 'simple';

			Format = FormatOption();
			Extension = '.' + Format;

			implantImg = (function(){
				var Png = Format === 'png';
				var Prefix = '<div class="uml-container">' + (Png?'<a href="':'<object type="image/svg+xml" class="uml-image" data="');
				var Infix = (Png?'"><img class="uml-image" src="':'"></object><a href="');
				var Suffix = (Png?'"></img></a>':'">Enlarge</a>') + '</div>';
				return function(ImgPath) {
					return Prefix + ImgPath + Infix + ImgPath + Suffix;
				};
			})();

			Threads = ThreadsOption();

			UmlTag = UmlTagOption();

			Remote = RemoteOption();

			AbsoluteOutputDirectory = path.join(process.cwd(),app.options.getValue('out'),RelativeOutputDirectory);

			PlantOptions = {format:Format,nbthread:Threads};

				var project = context.project;

				function lookupSymbolMapping(symbolId) {
					return project.symbolMapping[symbolId];
				}

				function handleTypeArgument(TypeArgument) {

				}

				function handleTypeArguments(TypeArgumens) {
					return '';
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
					return '';
				}

				function handleTypeParameter(TypeParameter) {

				}

				function handleTypeParameters(TypeParameters) {
					return '';
				}

				function handleParameter(Parameter) {
					return Parameter.name + ' : ' + handleType(Parameter.type);
					// app.logger.writeln(Parameter);
				}

				function handleParameters(Parameters) {
					if (Parameters) {
						var l = Parameters.length;
						var PUmls = new Array(l);
						for (var i=0;i<l;++i) {
							PUmls[i] = handleParameter(Parameters[i]);
						}
						return PUmls.join(',');
					}
					return '';
				}

				function handleSignature(Signature) {
					var PUml = '';
					if (Signature.kind === 4096 /* CallSignature */) {
						PUml = handleTypeParameters(Signature.typeParameters) + '(' + handleParameters(Signature.parameters) + ')' + ' : ' + handleType(Signature.type);
					}
					return PUml;
				}

				function handleSignatures(Signatures) {
					var PUml = '';
					if (Signatures) {
						for (var i=0,l=Signatures.length;i<l;++i) {
							PUml = PUml + handleSignature(Signatures[i]);
						}
					}
					return PUml;
				}

				function handleClassOrInterfaceMember(Member) {
					// app.logger.writeln(Member.name);
					var PUml = '';
					if (Member.kind === 1024 /* Property */) {
						PUml = Member.name + ' : ' + handleType(Member.type);
					} else if (Member.kind === 2048 /* Method */) {
						PUml = Member.name + handleSignatures(Member.signatures);
					}
					return PUml;
				}

				function handleClassOrInterfaceMembers(Members) {
					if (Members) {
						var l = Members.length;
						var PUmls = new Array(l);
						for (var i=0;i<l;++i) {
							PUmls[i] = handleClassOrInterfaceMember(Members[i]);
						}
						return PUmls.join('\n');
					}
					return '';
				}

				function handleExtImplArray(ExtImplArray) {
					if (ExtImplArray) {
						var ExtImplIds = new Array(ExtImplArray.length);
						for (var i=0,l=ExtImplArray.length;i<l;++i) {
							var ExtImpl = ExtImplArray[i];
							ExtImplIds[i] = lookupSymbolMapping(ExtImpl.symbolID);
						}
						return ExtImplIds;
					}
				}

				function handleClassOrInterface(CoI) {
					// app.logger.writeln(Indent + Child.name + ' ' + Child.kind + ' ' + Child.id);
					var PUml = '';
					//where to find "abstract"
					var CoIStr = '';
					if (CoI.kind === 128 /* Class */) CoIStr = 'class';
					else if (CoI.kind === 256 /* Interface */) CoIStr = 'interface';
					else app.logger.writeln('Do not know how to generate a class diagram for ' + CoI.name);
					PUml = CoIStr + ' ' + CoI.name + ' {\n' + handleClassOrInterfaceMembers(CoI.children) + '\n}';
					return {
						Id:CoI.id,
						CoIStr:CoIStr,
						Name:CoI.name,
						PUml:PUml,
						Extends:handleExtImplArray(CoI.extendedTypes),
						ExtendedBy:handleExtImplArray(CoI.extendedBy),
						Implements:handleExtImplArray(CoI.implementedTypes),
						ImplementedBy:handleExtImplArray(CoI.implementedBy)
					};
				}
				// go though all the reflections
				for (var key in project.reflections) {
						var reflection = project.reflections[key];
						if (reflection.kind === 128 || reflection.kind === 256) {
							var PUmlO = handleClassOrInterface(reflection);
							PUmlOTable[PUmlO.Id] = PUmlO;
							// app.logger.writeln('generated: ' + reflection.name + ' ' + PUmlO.Id);
						}
						if(UmlTag && reflection.comment) {
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
					segments = [];
			// if we have comment body text look for uml blocks
			if(text) {
				while ((match = umlExpression.exec(text)) != null) {
					segments.push(text.substring(index, match.index));
					// replace the uml block with the image link, which will later be generated.
					if (match[2]) {
						segments.push("![");
						if (match[1]) {
							// alternate text
							segments.push(match[1]);
						}
						//already start generating the uml image
						var Url = generatePlantUml('@startuml\n' + match[2] + '\n@enduml',CommentId,'../');
						segments.push("](" + Url + ")");
					}
					index = match.index + match[0].length;
				}
				// write modified comment back
				if(segments.length > 0) {
					segments.push(text.substring(index, text.length));
					return segments.join("");
				}
			}
			return text;
		}

		// get the output directory
		app.renderer.on("beginRender", function(event) {
			// no, we want relative links!
			// outputDirectory = path.join(event.outputDirectory, "assets/images/");
			// note, that the rendering stage has begun - from now on, images can be stored.
			RenderingStage = true;
		});

		// append style to main.css
		app.renderer.on("endRender", function(event) {
			PlantingProgressBar = new ProgressBar('Generating UML [:bar] :percent', {
				total: RemainingPlanters+1,
				width: 40
			});

			var filename = path.join(event.outputDirectory, "assets/css/main.css");
			fs.appendFileSync(filename,
				  '\n.uml-container { max-width: 100%; text-align: center; }'
				// + '\n.uml-container > .uml-image { max-width: 100%; }\n'
			);
			PlantingProgressBar.tick();
			// var data = fs.readFileSync(filename, "utf8") + "\n.uml { max-width: 100%; }\n";
			// fs.writeFileSync(filename, data, "utf8");
			setTimeout(checkModuleDone, 0);
		});

		// on render replace the external urls with local ones
		// on render replace the hierarchy with the svg

		var IndexPageMatcher = /index\.html/;
		app.renderer.on("endPage", function(page) {
			if (Complete && IndexPageMatcher.exec(page.url)) {
				var Contents = page.contents;
				if (Contents) {
					var InsertMatcher = /<div class="container container-main">[^]*?<div class="col-8 col-content">/;
					var Match = InsertMatcher.exec(Contents);
					if (Match) {
						var InsertPosition = Match.index + Match[0].length;
						var CompletePUml = getCompletePUml();
						var Url = generatePlantUml(CompletePUml,'CompleteClassDiagram','');
						page.contents = Contents.substring(0,InsertPosition) + '<div class="tsd-panel"><h3>Class Diagram</h3>' + implantImg(Url) + '</div>' + Contents.substring(InsertPosition);
					}
				}
				Complete = false;
			}
			if (Hierarchy || !ClassicHierarchy) {
				var Contents = page.contents;
				var Model = page.model;
				var ModelID = Model.id;
				var ModelName = Model.name;
				if (Contents) {
					var HierarchyRegex = /<section class="tsd-panel tsd-hierarchy">[^]*?<h3>Hierarchy<\/h3>([^]*?)<\/section>/;
					var Match = HierarchyRegex.exec(Contents);
					if (Match) {
						var MatchIndex = Match.index;
						var MatchEndIndex = MatchIndex + Match[0].length;
						var UmlHierarchy = '';
						if (Hierarchy) {
							var NeighbourhoodPUml = getNeighbourhoodPUmlForClass(ModelID);
							if (NeighbourhoodPUml) {
								var Url = generatePlantUml(NeighbourhoodPUml,ModelName,'../');
								UmlHierarchy = implantImg(Url);
							}
						}
						page.contents = Contents.substring(0,MatchIndex) + '<section class="tsd-panel tsd-hierarchy"><h3>Hierarchy</h3>' + ((ClassicHierarchyBefore)?Match[1]:'') + UmlHierarchy + ((ClassicHierarchyBehind)?Match[1]:'') + '</section>' + Contents.substring(MatchEndIndex);
					}
				}
			}


		});
}

module.exports = plugin;
