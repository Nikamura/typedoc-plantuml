# typedoc-plantuml
**Plugin for TypeDoc that generates images for PlantUML diagrams embedded in comments.**

Notes for this fork:

What I did so far:

+ added support for automatically generating class diagrams from typescript source
+ in case of local plantuml the RemoteURL is not first inserted and then searched & replaced again
+ user can also specify another remote url
+ added progress bar while generating uml
+ added following configuration options:

--umlClassicHierarchy               none,before,behind
 --umlComplete                       none,simple,detail
 --umlFormat                         png,svg
 --umlHierarchy                      none,simple,detail,alldetail
 --umlHierarchyDepthDown             [-1,∞)
 --umlHierarchyDepthUp               [-1,∞)
 --umlLocation                       /^local|remote|(?:https?:\/\/)?[^ "]*$/
 --umlSeperateClassDetailView        true|false
 --umlShowSpot                       true|false
 --umlTag                            true|false
 --umlThreads                        [1,∞)
 --umlVisibilityIcons                none,ascii,graphic

+ added lots of documentation for lots of changes

(Sorry, working on a business project - I am not allowed to share the fancier class diagrams, but it works - even multiple implements/extends-paths...)

What still is open, before I submit a pull request:

+ I'd like to switch to typescript soon
+ The test script is broken, I have to look into this...
+ I'd like to add some more modularity (eventually after moving to TypeScript), if you agree
+ The members-generation for class diagrams (generics, types, abstract, visibility) is not yet implemented
+ Probably more, if it comes to my mind, I will add it.
+ does it also work in --mode modules and with other templates?


### Installation

The plugin can then be installed using [npm](https://www.npmjs.com/):
 
```sh
$ npm install typedoc-plantuml --save-dev
```

### Usage

TypeDoc automatically detects plugins installed via npm. After installation TypeDoc can be used normally and UML 
diagrams in comments will be processed. 

The start of a UML diagram is indicated by the `<uml>` tag and closed by the `</uml>` tag. Alternate text for the
generated image can optionally be specified using the `alt` attribute. For example `<uml alt="Some diagram">`.

Note that the parser that finds the xml tags in the comment text is not very smart, so avoid unnecessary whitespace or 
other attributes to the tag.

The following is an example of embedding a sequence diagram in a class description.
  
```typescript
/**
 * Some class in a project.
 *
 * <uml>
 *     Bob->Alice : hello
 * </uml>
 */
export class SomeClass {

}
```

You can view the generated documentation [here](https://rawgit.com/artifacthealth/typedoc-plantuml/master/tests/baselines/reference/basic/classes/someclass.html).

Please refer to the [plantuml website](http://plantuml.com/) for a full reference on the supported UML syntax.

### Options

The following options are added to TypeDoc when the plugin is installed:

* `--umlLocation <local|remote>`<br> 
  Specifies the location of the generated uml images. If `local` then local image files are created in the assets 
  directory of the generated documentation. If `remote` then the image tag uses an encoded link to the
  [plantuml server](http://www.plantuml.com/plantuml/). Default is `local`.
* `--umlFormat <png|svg>`<br>
  Specifies the image format to use. Default is PNG.

### License

Licensed under the Apache License 2.0.  
