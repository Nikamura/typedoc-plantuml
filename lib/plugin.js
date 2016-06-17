var plantuml = require("node-plantuml");
var path = require("path");
var fs = require("fs");
var pako = require("pako");
var encode64 = require("./encode64");
var Converter = require("typedoc").Converter;

function plugin (plugins, cb) {

    var umlExpression = /<uml(?:\s+alt\s*=\s*['"](.+)['"]\s*)?>([\s\S]*?)<\/uml>/gi,
        encodedUmlExpression = /<img src="http:\/\/www.plantuml.com\/plantuml\/(?:img|png|svg)\/([^"]*)"(?: alt="(.*)")?>/g,
        outputDirectory,
        server = "http://www.plantuml.com/plantuml/",
        format,
        location;

		var PUmlOTable = [];

    var app = plugins.application;

    // setup options
    app.options.addDeclaration({
        name: 'umlLocation',
        help: 'local|remote',
        defaultValue: 'local'
    });

    app.options.addDeclaration({
        name: 'umlFormat',
        help: 'png|svg',
        defaultValue: 'png'
    });

    // on resolve replace uml blocks with image link to encoded uml data
    app.converter.on("resolveBegin", function (context) {

        // ensure valid format
        format = app.options.getValue("umlFormat");
        if(format) {
            format = format.toLowerCase();
        }
        if(format != "png" && format != "svg") {
            format = "png";
        }

        // ensure valid location
        location = app.options.getValue("umlLocation");
        if(location) {
            location = location.toLowerCase();
        }
        if(location != "local" && location != "remote") {
            location = "local";
        }

        var project = context.project;
				// app.logger.writeln(project);
				//go through the tree

				// return {
				// 	Id:CoI.id,
				// 	PUml:PUml,
				// 	Extends:handleExtImplArray(CoI.extendedTypes),
				// 	ExtendedBy:handleExtImplArray(CoI.extendedBy),
				// 	Implements:handleExtImplArray(CoI.implementedTypes),
				// 	ImplementedBy:handleExtImplArray(CoI.implementedBy)
				// };

				function getExtImplPUml(From,ExtImplArray,Arrow,To) {
					if (ExtImplArray) {
						Arrow = ' ' + Arrow + ' ';
						if (From) From = From + Arrow;
						else      From = '';
						if (To)   To = Arrow + To;
						else      To = '';
						var l = ExtImplArray.length;
						var PUmls = new Array(l);
						for (var i=0;i<l;++i) {
							var TargetPUmlO = PUmlOTable[ExtImplArray[i]];
							PUmls[i] = From + TargetPUmlO.Name + To;
						}
						return PUmls.join('\n');
					}
					return '';
				}

				function getNeighbourhoodPUmlForClass(Id) {
					var PUmls = [];
					var ThisPUmlO = PUmlOTable[Id];
					if (ThisPUmlO) {
						app.logger.writeln(ThisPUmlO);
						var ThisName = ThisPUmlO.Name;
						PUmls.push(ThisPUmlO.PUml);
						var ExtImpPUml;
						ExtImpPUml = getExtImplPUml(undefined,ThisPUmlO.Extends,'<|--',ThisName);
						if (ExtImpPUml) PUmls.push(ExtImpPUml);
						ExtImpPUml = getExtImplPUml(ThisName,ThisPUmlO.ExtendedBy,'<|--');
						if (ExtImpPUml) PUmls.push(ExtImpPUml);
						ExtImpPUml = getExtImplPUml(undefined,ThisPUmlO.Implements,'<|..',ThisName);
						if (ExtImpPUml) PUmls.push(ExtImpPUml);
						ExtImpPUml = getExtImplPUml(ThisName,ThisPUmlO.ImplementedBy,'<|..');
						if (ExtImpPUml) PUmls.push(ExtImpPUml);
					}
					return PUmls.join('\n');
				}

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
					if (CoI.kind === 128 /* Class */) PUml = PUml + 'class ';
					else if (CoI.kind === 256 /* Interface */) PUml = PUml + 'interface ';
					else app.logger.writeln('Do not know how to generate a class diagram for ' + Child.name);
					PUml = PUml + CoI.name + ' {\n' + handleClassOrInterfaceMembers(CoI.children) + '}';
					return {
						Id:CoI.id,
						Name:CoI.name,
						PUml:PUml,
						Extends:handleExtImplArray(CoI.extendedTypes),
						ExtendedBy:handleExtImplArray(CoI.extendedBy),
						Implements:handleExtImplArray(CoI.implementedTypes),
						ImplementedBy:handleExtImplArray(CoI.implementedBy)
					};
				}
				// handleChild(project,'');
// app.logger.writeln(project);
        // go though all the comments
        for (var key in project.reflections) {
            var reflection = project.reflections[key];
						// if (reflection.kind === 128 || reflection.kind === 256) app.logger.writeln(reflection.flags);
            // app.logger.writeln(reflection.name + ' : ' + reflection.kind);
						if (reflection.kind === 128 || reflection.kind === 256) {
							var PUmlO = handleClassOrInterface(reflection);
							PUmlOTable[PUmlO.Id] = PUmlO;
							app.logger.writeln('generated: ' + reflection.name + ' ' + PUmlO.Id);
						}
            if(reflection.comment) {
                reflection.comment.shortText = processText(reflection.comment.shortText);
                reflection.comment.text = processText(reflection.comment.text);
            }
        }
				app.logger.writeln(getNeighbourhoodPUmlForClass(17342));
    });



    function processText(text) {
        var match,
            index = 0,
            segments = [];

        // if we have comment body text look for uml blocks
        if(text) {
            while ((match = umlExpression.exec(text)) != null) {

                segments.push(text.substring(index, match.index));

                // replace the uml block with a link to plantuml.com with the encoded uml data
                if (match[2]) {
                    segments.push("![");
                    if (match[1]) {
                        // alternate text
                        segments.push(match[1]);
                    }
                    segments.push("](" + server + format + "/");
                    segments.push(encode(match[2]));
                    segments.push(")");
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

    function encode(text) {

        return encode64.encode(pako.deflate(text, { level: 9, to: 'string' }));
    }

    // get the output directory
    app.renderer.on("beginRender", function(event) {

        outputDirectory = path.join(event.outputDirectory, "assets/images/");
    });

    // append style to main.css
    app.renderer.on("endRender", function(event) {

        var filename = path.join(event.outputDirectory, "assets/css/main.css");
        var data = fs.readFileSync(filename, "utf8") + "\n.uml { max-width: 100%; }\n";
        fs.writeFileSync(filename, data, "utf8");
    });

    // on render replace the external urls with local ones
    app.renderer.on("endPage", function(page) {

        // rewrite the image links to: 1) generate local images, 2) transform to <object> tag for svg, 3) add css class
        var contents = page.contents,
            index = 0,
            match,
            segments = [],
            started = 0;

        if (contents) {
            while ((match = encodedUmlExpression.exec(contents)) != null) {

                segments.push(contents.substring(index, match.index));

                // get the image source
                var src = match[1],
                    alt = match[2];

                // decode image and write to disk if using local images
                if (location == "local") {
                    // keep track of how many images are still being written to disk
                    started++;
                    src = writeLocalImage(page.filename, src, function () {
                        started--;
                        if (started == 0 && match == null && cb) {
                            cb();
                        }
                    });
                }
                else {
                    // this is the case where we have a remote file, so we don't need to write out the image but
                    // we need to add the server back into the image source since it was removed by the regex
                    src = server + format + "/" + src;
                }

                // re-write image tag
                if (format == "png") {
                    segments.push("<img class=\"uml\" src=");
                    // replace external path in content with path to image to assets directory
                    segments.push("\"" + src + "\"");
                    if (alt) {
                        segments.push(" alt=\"" + alt + "\"");
                    }
                    segments.push(">");
                }
                else {
                    segments.push("<object type=\"image/svg+xml\" class=\"uml\" data=\"");
                    segments.push(src);
                    segments.push("\">");
                    if (alt) {
                        segments.push(alt);
                    }
                    segments.push("</object>");
                }

                index = match.index + match[0].length;
            }

            // write modified contents back to page
            if (segments.length > 0) {
                segments.push(contents.substring(index, contents.length));
                page.contents = segments.join("");
            }
        }

        // if local images were not generated then call the callback now if we have one
        if(location == "remote" && cb) {
            setTimeout(cb, 0);
        }
    });

    // the uml image number
    var num = 0;

    function writeLocalImage(pageFilename, src, cb) {

        // setup plantuml encoder and decoder
        var decode = plantuml.decode(src);
        var gen = plantuml.generate({format: format});

        // get image filename
        var filename = "uml" + (++num) + "." + format;
        var imagePath = path.join(outputDirectory, filename);

        // decode and save png to assets directory
        decode.out.pipe(gen.in);
        gen.out.pipe(fs.createWriteStream(imagePath));
        gen.out.on('finish', cb);

        // get relative path filename
        var currentDirectory = path.dirname(pageFilename);
        // return the relative path
        return path.relative(currentDirectory, imagePath);
    }
}

module.exports = plugin;
