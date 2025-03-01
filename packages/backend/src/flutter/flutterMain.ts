import {
  stringToClassName,
  generateWidgetCode,
} from "../common/numToAutoFixed";
import { retrieveTopFill } from "../common/retrieveFill";
import { FlutterDefaultBuilder } from "./flutterDefaultBuilder";
import { FlutterTextBuilder } from "./flutterTextBuilder";
import { indentString } from "../common/indentString";
import {
  getCrossAxisAlignment,
  getMainAxisAlignment,
} from "./builderImpl/flutterAutoLayout";
import { commonSortChildrenWhenInferredAutoLayout } from "../common/commonChildrenOrder";
import { PluginSettings } from "types";
import { addWarning } from "../common/commonConversionWarnings";

let localSettings: PluginSettings;
let previousExecutionCache: string[];

const getFullAppTemplate = (name: string, injectCode: string): string =>
  `import 'package:flutter/material.dart';

void main() {
  runApp(const FigmaToCodeApp());
}

// Generated by: https://www.figma.com/community/plugin/842128343887142055/
class FigmaToCodeApp extends StatelessWidget {
  const FigmaToCodeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color.fromARGB(255, 18, 32, 47),
      ),
      home: Scaffold(
        body: ListView(children: [
          ${name}(),
        ]),
      ),
    );
  }
}

class ${name} extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ${indentString(injectCode, 4).trimStart()};
  }
}`;

const getStatelessTemplate = (name: string, injectCode: string): string =>
  `class ${name} extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ${indentString(injectCode, 4).trimStart()};
  }
}`;

export const flutterMain = (
  sceneNode: ReadonlyArray<SceneNode>,
  settings: PluginSettings,
): string => {
  localSettings = settings;
  previousExecutionCache = [];

  let result = flutterWidgetGenerator(sceneNode).trim();
  //read all lines
  let lines = result.split("\n");
  for (let i = 0; i < lines.length; i++) {
    //Remove invalid lines
    if (lines[i].trim() == ",") {
      lines[i] = "";
    }

    if (lines[i].indexOf("textDecoration:") > -1) {
      lines[i] = lines[i].replace("textDecoration:", "decoration:");
    }
    if (lines[i].indexOf("Border.only(") > -1) {
      lines[i] = lines[i].replace("Border.only(", "Border(");
    }
  }

  // My Custom Adjustment
  if (lines[0].indexOf("Container") > -1) {
    if (lines[1].indexOf("width:") > -1) {
      lines[1] = "width: MediaQuery.of(context).size.width,";
    }
    if (lines[2].indexOf("height:") > -1) {
      // sometime we will need this height if the widget is Stack,
      // so we will not remove it for now
      // let heightValue = lines[2].split("height:")[1].split(",")[0].trim();
      // lines[2] = lines[2].replaceAll(heightValue, "null");
    }
  }

  result = lines.join("\n");
  result = result.trim();

  //if not ends with , add , at the end
  if (!result.endsWith(",")) {
    result = result + ",";
  }

  //set clippboard
  // figma.ui.postMessage({ type: "copyToClipboard", data: result });

  switch (localSettings.flutterGenerationMode) {
    case "snippet":
      return result;
    case "stateless":
      result = generateWidgetCode("Column", { children: [result] });
      return getStatelessTemplate(stringToClassName(sceneNode[0].name), result);
    case "fullApp":
      result = generateWidgetCode("Column", { children: [result] });
      return getFullAppTemplate(stringToClassName(sceneNode[0].name), result);
  }

  return result;
};

const flutterWidgetGenerator = (
  sceneNode: ReadonlyArray<SceneNode>,
): string => {
  let comp: string[] = [];

  // filter non visible nodes. This is necessary at this step because conversion already happened.
  const visibleSceneNode = sceneNode.filter((d) => d.visible);
  const sceneLen = visibleSceneNode.length;

  visibleSceneNode.forEach((node, index) => {
    switch (node.type) {
      case "RECTANGLE":
      case "ELLIPSE":
      case "STAR":
      case "POLYGON":
      case "LINE":
        comp.push(flutterContainer(node, ""));
        break;
      case "GROUP":
        comp.push(flutterGroup(node));
        break;
      case "FRAME":
      case "INSTANCE":
      case "COMPONENT":
      case "COMPONENT_SET":
        comp.push(flutterFrame(node));
        break;
      case "SECTION":
        comp.push(flutterContainer(node, ""));
        break;
      case "TEXT":
        comp.push(flutterText(node));
        break;
      case "VECTOR":
        addWarning("VectorNodes are not supported in Flutter");
        break;
      default:
      // do nothing
    }

    if (index !== sceneLen - 1) {
      const spacing = addSpacingIfNeeded(node, localSettings.optimizeLayout);
      if (spacing) {
        comp.push(spacing);
      }
    }
  });

  return comp.join(",\n");
};

const flutterGroup = (node: GroupNode): string => {
  const widget = flutterWidgetGenerator(node.children);
  return flutterContainer(
    node,
    generateWidgetCode("Stack", {
      children: widget ? [widget] : [],
    }),
  );
};

const flutterContainer = (node: SceneNode, child: string): string => {
  let propChild = "";

  let image = "";
  if ("fills" in node && retrieveTopFill(node.fills)?.type === "IMAGE") {
    addWarning("Image fills are replaced with placeholders");
    // image = `Image.network("https://via.placeholder.com/${node.width.toFixed(

    let nodeWidth = node.width.toFixed(0);
    let nodeHeight = node.height.toFixed(0);
    image = `Image.network("https://placehold.co/${nodeWidth}x${nodeHeight}.png")`;
  }

  if (child.length > 0) {
    propChild = child;
  }

  const builder = new FlutterDefaultBuilder(propChild)
    .createContainer(node, localSettings.optimizeLayout)
    .blendAttr(node)
    .position(node, localSettings.optimizeLayout);

  return builder.child;
};

const flutterText = (node: TextNode): string => {
  const builder = new FlutterTextBuilder().createText(node);
  previousExecutionCache.push(builder.child);

  return builder
    .blendAttr(node)
    .textAutoSize(node)
    .position(node, localSettings.optimizeLayout).child;
};

const flutterFrame = (
  node: SceneNode & BaseFrameMixin & MinimalBlendMixin,
): string => {
  const children = flutterWidgetGenerator(
    commonSortChildrenWhenInferredAutoLayout(
      node,
      localSettings.optimizeLayout,
    ),
  );

  if (node.layoutMode !== "NONE") {
    const rowColumn = makeRowColumn(node, children);
    return flutterContainer(node, rowColumn);
  } else {
    if (localSettings.optimizeLayout && node.inferredAutoLayout) {
      const rowColumn = makeRowColumn(node.inferredAutoLayout, children);
      return flutterContainer(node, rowColumn);
    }

    if (node.isAsset) {
      return flutterContainer(node, generateWidgetCode("FlutterLogo", {}));
    }

    return flutterContainer(
      node,
      generateWidgetCode("Stack", {
        children: children !== "" ? [children] : [],
      }),
    );
  }
};

const makeRowColumn = (
  autoLayout: InferredAutoLayoutResult,
  children: string,
): string => {
  const rowOrColumn = autoLayout.layoutMode === "HORIZONTAL" ? "Row" : "Column";

  const widgetProps = {
    mainAxisSize: "MainAxisSize.min",
    // mainAxisSize: getFlex(node, autoLayout),
    mainAxisAlignment: getMainAxisAlignment(autoLayout),
    crossAxisAlignment: getCrossAxisAlignment(autoLayout),
    children: [children],
  };

  return generateWidgetCode(rowOrColumn, widgetProps);
};

const addSpacingIfNeeded = (
  node: SceneNode,
  optimizeLayout: boolean,
): string => {
  const nodeParentLayout =
    optimizeLayout && node.parent && "itemSpacing" in node.parent
      ? node.parent.inferredAutoLayout
      : node.parent;

  if (
    nodeParentLayout &&
    node.parent?.type === "FRAME" &&
    "itemSpacing" in nodeParentLayout &&
    nodeParentLayout.layoutMode !== "NONE"
  ) {
    if (nodeParentLayout.itemSpacing > 0) {
      if (nodeParentLayout.layoutMode === "HORIZONTAL") {
        return generateWidgetCode("const SizedBox", {
          width: nodeParentLayout.itemSpacing,
        });
      } else if (nodeParentLayout.layoutMode === "VERTICAL") {
        return generateWidgetCode("const SizedBox", {
          height: nodeParentLayout.itemSpacing,
        });
      }
    }
  }
  return "";
};

export const flutterCodeGenTextStyles = () => {
  const result = previousExecutionCache
    .map((style) => `${style}`)
    .join("\n// ---\n");

  if (!result) {
    return "// No text styles in this selection";
  }
  return result;
};
