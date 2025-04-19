import luaparse from "luaparse";
import prettier from "prettier/standalone.js";
import parserBabel from "prettier/parser-babel.js";
// import { ast } from "luaparse";
import * as path from "path";
// import formatTokenize from "@stdlib/string-base-format-tokenize";
// import formatInterpolate from "@stdlib/string-base-format-interpolate";

// lch begin
let LUA_SYSTEM_LIB = new Set(["table", "io", "string", "package", "math", "debug", "os", "utf8", "rapidjson"]);

let LUA_GLOBAL_LIB = new Set(
    Array.from(LUA_SYSTEM_LIB).concat([
        "_G",
        "setmetatable",
        "rawget",
        "rawset",
        "rawlen",
        "type",
        "assert",
        "__VERSION",
        "dofile",
        "error",
        "getmetatable",
        "tonumber",
        "tostring",
        "xpcall",
        "pcall",
        "pairs",
        "print",
        "next",
        "assert",
    ])
);

let LUA_META_CALLER = new Set([
    "Vector3",
    "FixQuaternion",
    "FixVector3",
    "Bounds",
    "Color",
    "LayerMask",
    "Plane",
    "Quaternion",
    "Ray",
    "Vector2",
    "Vector4",
]);

let LUA_MULTI_RETURN_FUNC = new Map([["GameUtil.createItemElement", 3]]);

// key 是关键字，value是是否保留call
let LUA_REMOVE_PROTOTYPE_KEY = new Map([
    ["super", true],
    ["callFunc", true],
    ["toplevel", true],
    ["New", false],
]);

let LUA_DYNAMIC_STATIC_FUNCTION_KEY = new Set(["loadPlayerViewFinish", "onHandle", "updateMsg"]);

let LUA_ADD_CALL_KEY = new Set(["listener[2]"]);

let LUA_FUNCTION_CALL_INFO = {
    super: {
        prototype: true,
    },
    callFunc: {
        prototype: true,
    },
    toplevel: {
        prototype: true,
    },
    New: {
        prototype: false,
    },
    // 底下这仨都是运行时改的，所以要特殊处理下
    loadPlayerViewFinish: {
        prototype: false,
        call: true,
        addThis: true,
    },
    onHandle: {
        matchArg: "tempMsg",
        prototype: false,
        call: true,
        addThis: true,
    },
    updateMsg: {
        prototype: false,
        call: true,
        addThis: true,
    },
};

let l2jSystemFuncs = new Set();
let l2jGlobalVars = new Set();
let l2jInitedGlobalVars = new Set();
let astStack = [];
let commentData = [];
let savedLastLineIndex = 0;
let localVarStacks = [];
let replaceOperatorToFunc = false;
let exportAsESM = true;
let hasModuleDefined = false;
let globalVarNeedDefine = undefined;
let sourceFilePath;
let scopeStack = [];
let declaredClasses = new Set();
let hasSelfCall = false;

let currentFileName = "";
let currentClassName = undefined;
let localThisArgUsed = false;
let outsideClassString = "";
let classKeyStringDefined = undefined;
let argIndex = 0;

const LUA_PARSER_OPTIONS = {
    comments: true,
    locations: true,
    ranges: true,
    scope: true,
    luaVersion: "5.3",
    onCreateScope: () => {
        scopeStack.push(new Map());
    },
    onDestroyScope: () => {
        scopeStack.pop();
    },
    // onLocalDeclaration: (name) => {
    //     console.log(`localDeclaration: ${name}`);

    //     // localStacks[localStacks.length - 1].add(name);
    // },
    onCreateNode: (node) => {
        //console.log(`creteNode: ${node.type}`);
        if (node.type === "LocalStatement") {
            let infos = scopeStack[scopeStack.length - 1];
            node.variables.forEach((v) => {
                if (v.type !== "Identifier") return;
                let name = v.name;
                let found = infos.get(name);
                if (found !== undefined) {
                    if (name === "_") {
                        // _变量直接给替换掉
                        v.name = `_${++found}`;
                        infos.set(name, found);
                    } else {
                        node.duplicated = true;
                    }
                } else {
                    infos.set(name, 0);
                }
            });
        }
    },
};

function initGlobalVars(source, ast, asESM) {
    astStack = [];
    commentData = [];
    savedLastLineIndex = 0;
    localVarStacks = [];
    replaceOperatorToFunc = false;
    exportAsESM = true;
    hasModuleDefined = false;
    globalVarNeedDefine = undefined;
    declaredClasses = new Set();
    currentClassName = undefined;
    localThisArgUsed = false;
    outsideClassString = "";
    classKeyStringDefined = undefined;
    argIndex = 0;

    sourceFilePath = source;
    currentFileName = path.basename(sourceFilePath).replace(path.extname(sourceFilePath), "");
    if (asESM !== undefined) exportAsESM = asESM;

    verifyOperationConfig(source);
    if (ast.globals?.length > 0) {
        for (let v of ast.globals) if (!LUA_GLOBAL_LIB.has(v)) l2jGlobalVars.add(v.name);
    }
    createCommentData(ast);
}

function setCurrentClassName(name) {
    currentClassName = name.replaceAll(".", "_");
    // if (currentClassName !== undefined && astStack.length > 1) {
    //     let ast = astStack[astStack.length - 2];
    //     if (ast instanceof Array) {
    //         ast.forEach((v) => (v.isClassMode = true));
    //     }
    // }
}

function isInFunctionDeclaration() {
    for (let i = astStack.length - 1; i >= 0; i--) {
        let ast = astStack[i];
        if (!(ast instanceof Array) && ast.type === "FunctionDeclaration") {
            return true;
        }
    }
    return false;
}

function isInLocalFunction() {
    let stack = 0;
    for (let i = astStack.length - 1; i >= 0; i--) {
        let ast = astStack[i];
        if (!(ast instanceof Array) && ast.type === "FunctionDeclaration") {
            if (++stack >= 2) return true;
        }
    }
    return false;
}

function isInClassDeclaration() {
    return currentClassName !== undefined;
}

function inClassKeyDefined() {
    return (
        classKeyStringDefined !== undefined &&
        (classKeyStringDefined === astStack.length - 1 || classKeyStringDefined === astStack.length - 3)
    );
}

function isFunctionParameter(name) {
    for (let i = astStack.length - 2; i >= 0; i--) {
        let ast = astStack[i];
        if (ast.type === "FunctionDeclaration") {
            for (let p of ast.parameters) {
                if (p.name === name) return true;
            }
        }
    }
    return false;
}

function isInIfClauses() {
    // for (let i = astStack.length - 2; i >= 0; i--) {
    let ast = astStack[astStack.length - 3];
    if (ast.type === "IfClause" || ast.type === "ElseifClause") return true;
    // }
    return false;
}
// lch end

function joinUnderscore(length) {
    return Array.from({ length }, () => "_").join("");
}
function toCamel(s) {
    if (s === "var") return "varInfo";
    else if (s === "super") return "Super";
    else if (s === "new") return "New";
    else if (s === "import") return "Import";
    else if (s === "package") return "Package";
    else if (s === "typeof") return "l2j.typeof";
    else if (l2jGlobalVars.has(s) && isInIfClauses()) return `globalThis.${s}`;

    // else if (LUA_GLOBAL_LIB.has(s)) return `l2j_${s}`;
    return s;
    // let status = -1;
    // let res = [];
    // let longUnderscoreCnt = 0;
    // for (const c of s) {
    //     if (c == "_") {
    //         if (status == -1) {
    //             res.push(c);
    //         } else if (status == 0) {
    //             status = 1;
    //         } else if (status == 1 || status == 2) {
    //             status = 2;
    //             longUnderscoreCnt += 1;
    //         }
    //     } else if (status == -1) {
    //         //第一个非_字符
    //         res.push(c);
    //         status = 0;
    //     } else if (status == 0) {
    //         res.push(c);
    //     } else if (status == 1) {
    //         if (/[A-Z]/.test(c)) {
    //             res.push("_" + c);
    //         } else {
    //             res.push(c.toUpperCase());
    //         }
    //         status = 0;
    //     } else if (status == 2) {
    //         res.push(joinUnderscore(longUnderscoreCnt + 1) + c);
    //         longUnderscoreCnt = 0;
    //         status = 0;
    //     }
    // }
    // if (status == 1) {
    //     res.push("_");
    // } else if (status == 2) {
    //     res.push(joinUnderscore(longUnderscoreCnt + 1));
    // }
    // return res.join("");
}

// "base": {
//             "type": "MemberExpression",
//             "indexer": ".",
//             "identifier": {
//               "type": "Identifier",
//               "name": "format"
//             },
//             "base": {
//               "type": "Identifier",
//               "name": "string"
//             }
// }
const IdentifierMap = {
    constructor: "_constructor",
    extends: "_extends",
    class: "_class",
    default: "_js_default",
    debugger: "_debugger",
};
const binaryOpMap = {
    "..": "+",
    and: "&&",
    or: "||",
    "==": "===",
    "~=": "!==",
};
function traverseAst(ast, callback) {
    astStack.push(ast);
    if (ast instanceof Array) {
        for (let i = 0; i < ast.length; i++) {
            traverseAst(ast[i], callback);
        }
    } else if (ast instanceof Object) {
        if (ast.type !== undefined) {
            callback(ast);
        }
        for (let key in ast) {
            if (key !== "type") {
                traverseAst(ast[key], callback);
            }
        }
    } else {
    }
    astStack.pop();
}
function insertPrototypeNode(base) {
    return {
        type: "MemberExpression",
        indexer: ".",
        identifier: {
            type: "Identifier",
            name: "prototype",
        },
        base: base,
    };
}
function isClassExtends(ast) {
    return (
        ast.base?.type == "Identifier" &&
        ast.base?.name == "class" &&
        ast.arguments instanceof Array &&
        ast.arguments.length == 2
    );
}
function isErrorCall(ast) {
    return ast.base?.type === "Identifier" && ast.base?.name == "error";
}
function luaError2JsThrow(ast) {
    return `throw new Error(${ast2js(ast.arguments[0])})`;
}
function isStringFormatCall(ast) {
    return (
        ((ast.base?.type === "Identifier" && ast.base?.name === "string_format") ||
            (ast.base?.type === "MemberExpression" &&
                ast.base?.identifier?.name === "format" &&
                ast.base?.base?.name === "string")) &&
        ast.arguments.length > 1 &&
        ast.arguments[0].type === "StringLiteral"
        // && ast.arguments[0].raw.includes("%s")
    );
}
function isTableInsertCall(ast) {
    return (
        ast.arguments?.length == 2 &&
        ((ast.base?.type === "Identifier" && ast.base?.name === "table_insert") ||
            (ast.base?.type === "MemberExpression" &&
                ast.base?.identifier?.name === "insert" &&
                ast.base?.base?.name === "table"))
    );
}
function isNumerOne(ast) {
    return ast.type == "NumericLiteral" && ast.value == 1;
}
function isTableInsertAtHeadCall(ast) {
    // return ast.arguments?.length == 3 && isNumerOne(ast.arguments[1]) && (
    return (
        ast.arguments?.length == 3 &&
        ((ast.base?.type === "Identifier" && ast.base?.name === "table_insert") ||
            (ast.base?.type === "MemberExpression" &&
                ast.base?.identifier?.name === "insert" &&
                ast.base?.base?.name === "table"))
    );
}
function luaInsert2JsUnshift(ast) {
    // tansform lua table.insert(t, 1) / table_insert(t, 1) to js t.push(1)
    let [base, index, element] = ast.arguments;
    // return `${ast2js(base)}.unshift(${ast2js(element)})`;
    return `l2j.table.insert(${ast2js(base)}, ${ast2js(index)}, ${ast2js(element)})`;
}
function luaInsert2JsPush(ast) {
    // tansform lua table.insert(t, 1) / table_insert(t, 1) to js t.push(1)
    let [base, element] = ast.arguments;
    // return `${ast2js(base)}.push(${ast2js(element)})`;
    return `l2j.table.insert(${ast2js(base)}, ${ast2js(element)})`;
}

function isTableConcatCall(ast) {
    return (
        (ast.base?.type === "Identifier" && ast.base?.name === "table_concat") ||
        (ast.base?.type === "MemberExpression" &&
            ast.base?.identifier?.name === "concat" &&
            ast.base?.base?.name === "table")
    );
}

function luaConcat2JsJoin(ast) {
    // tansform lua table.concat(t, ',') / table_concat(t, ',') to js t.join(',')
    // return `${ast2js(ast.arguments[0])}.join(${ast.arguments[1] ? ast2js(ast.arguments[1]) : '""'})`;
    return `l2j.table.concat(${ast2js(ast.arguments[0])}, ${ast.arguments[1] ? ast2js(ast.arguments[1]) : '""'})`;
}
function isInstanceMethod(ast) {
    return (
        ast.type == "FunctionDeclaration" &&
        ast.identifier?.type == "MemberExpression" &&
        ast.parameters[0] &&
        ast.parameters[0].type == "Identifier" &&
        ast.parameters[0].name == "self"
    );
}
function isAssertCall(ast) {
    return ast.base?.type === "Identifier" && ast.base?.name === "assert";
}
function luaAssert2JsIfThrow(ast) {
    // tansform lua assert(bool, error) to js if (!bool) {throw new Error(error)}
    if (ast.arguments.length == 1) {
        return `if (!(${ast2js(ast.arguments[0])})) {throw new Error("assertion failed!")}`;
    } else {
        return `if (!(${ast2js(ast.arguments[0])})) {throw new Error(${ast2js(ast.arguments[1])})}`;
    }
}
function isTypeCall(ast) {
    return ast.base?.type === "Identifier" && ast.base?.name === "type";
}

// lch begin
function getThisVarName() {
    // return isTopScope() ? "this" : "thisArg";
    return "this";
    // return isInLocalFunction() ? "thisArg" : "this";
}
function isLuaRequireFunc(ast) {
    return ast.base?.type === "Identifier" && ast.base?.name === "require";
}
function convertLuaRequireFunc(ast) {
    return `l2j.require(${ast.arguments?.map(ast2js).join(", ")})`;
}

function isLuaSystemFunc(ast) {
    return (
        ast.base?.type === "MemberExpression" &&
        ast.base?.base?.type === "Identifier" &&
        LUA_SYSTEM_LIB.has(ast.base?.base?.name)
    );
}
function convertLuaSystemFunc(ast) {
    let libName = ast.base?.base?.name;
    let funcName = ast.base?.identifier?.name;
    let convertName = `${libName}.${funcName}`;
    if (!("l2j" in globalThis && convertName in globalThis.l2j)) {
        l2jSystemFuncs.add(convertName);
    }
    return `l2j.${convertName}(${ast.arguments?.map(ast2js).join(", ")})`;
}

function isCustomLuaClassLocalDefine(ast) {
    return (
        astStack.length === 3 &&
        ast.variables?.length == 1 &&
        ast.init?.length == 1 &&
        ((ast.init[0].type == "TableConstructorExpression" &&
            ast.variables[0]?.name == "M" &&
            ast.init[0]?.fields?.length === 0) ||
            (ast.init[0]?.type == "CallExpression" && ast.init[0]?.base?.name === "class"))
    );
}
function convertCustomLuaClassFunc(ast) {
    let ret;
    if (ast.init[0].type == "TableConstructorExpression") {
        ret = `let ${ast.variables[0]?.name} = l2j.createClass("${currentFileName}")`;
    } else {
        ret = `let ${ast.variables[0]?.name} = ${ast2js(ast.init[0])}`;
    }
    if (ret.indexOf("l2j.createClass")) declaredClasses.add(ast.variables[0]?.name);
    return ret;
}

function isCustomClassCall(ast) {
    return ast.base?.type === "Identifier" && ast.base?.name === "class" && ast.arguments.length >= 1;
}
function convertCustomClassCall(ast) {
    return `l2j.createClass(${ast.arguments.map(ast2js).join(", ")})`;
}

function createCommentData(ast) {
    commentData = [];
    if (ast.comments !== undefined) {
        commentData = Array.from(ast.comments);
        commentData.sort((a, b) => {
            let lineDelta = a.loc.start.line - b.loc.start.line;
            if (lineDelta !== 0) return lineDelta;

            return a.loc.start.column - b.loc.start.column;
        });
    }
}
function processBeforeAst2Js(ast) {
    let astLine = ast.loc?.start?.line || 0;

    let lastLine = savedLastLineIndex;
    if (astLine > 0) savedLastLineIndex = astLine;

    // 处理空行以及注释
    let ret = "";
    for (let i = lastLine + 1; i < astLine; i++) {
        if (commentData.length > 0 && commentData[0].loc.start.line === i) {
            let comment = commentData.shift();
            ret += comment.raw.replace("--[[", "/*").replace("]]", "*/").replace("--", `//`) + "\n";
        } else {
            ret += "\n";
        }
    }

    localVarStacks.push(new Set());

    return ret;
}
function processAfterAst2Js(ast) {
    localVarStacks.pop();

    let astLine = ast.loc?.end?.line || 0;

    let ret = "";
    while (commentData.length > 0 && commentData[0].loc.start.line === astLine) {
        let comment = commentData.shift();
        ret += `//${comment.value}\n`;
    }
    return ret;
}

function verifyOperationConfig(sourcePath) {
    // 写死路径
    if (sourcePath === undefined) return;
    sourcePath = sourcePath.replace(/\\/g, "/");
    replaceOperatorToFunc =
        sourcePath.indexOf("DataCenter") == -1 &&
        sourcePath.indexOf("battleLog") == -1 &&
        (sourcePath.indexOf("Battle/") >= 0 || sourcePath.indexOf("BattleView/") >= 0);
}

function isASTLeftOrRightType(ast, type) {
    return ast.left?.type === type || ast.right?.type === type;
}

function verifyBinaryExpression(ast, op) {
    if (!replaceOperatorToFunc) return;
    if (isASTLeftOrRightType(ast, "StringLiteral")) return;

    switch (op) {
        case "+":
            return "l2j.add";
        case "-":
            return "l2j.sub";
        case "*":
            return "l2j.mul";
        case "/":
            return "l2j.div";
        case "==":
            return "l2j.eq";
    }
}

function verifyLogicExpression(ast, op) {
    let needConvert = false;
    for (let i = astStack.length - 1; i >= 0; --i) {
        let t = astStack[i].type;
        if (t === "LocalStatement" || t === "AssignmentStatement") {
            needConvert = true;
            break;
        } else if (t === "FunctionDeclaration") {
            break;
        }
    }
    if (!needConvert) return;

    // console.log(`logic expression converted, file: ${sourceFilePath}, line: ${ast.loc.start.line}`);
    // lua的and和or和js有细微差别，比如 c = 0 and(or) 1，两者结果不同
    switch (op) {
        case "||":
            return "l2j.or";
        case "&&":
            return "l2j.and";
    }
}

function verifyUnaryExpression(op) {
    if (!replaceOperatorToFunc) return;

    if (op === "-") return "l2j.neg";
}
// lch end

function luaType2JsTypeof(ast) {
    // tansform lua type(foo) js typeof(foo)
    return `l2j.luaType(${ast2js(ast.arguments[0])})`;
}
// {
//       "type": "AssignmentStatement",
//       "variables": [
//         {
//           "type": "IndexExpression",
//           "base": {
//             "type": "Identifier",
//             "name": "t"
//           },
//           "index": {
//             "type": "BinaryExpression",
//             "operator": "+",
//             "left": {
//               "type": "UnaryExpression",
//               "operator": "#",
//               "argument": {
//                 "type": "Identifier",
//                 "name": "t"
//               }
//             },
//             "right": {
//               "type": "NumericLiteral",
//               "value": 1,
//               "raw": "1"
//             }
//           }
//         }
//       ],
//       "init": [
//         {
//           "type": "Identifier",
//           "name": "b"
//         }
//       ]
//     }
function isIndexPlusOne(left, right, name) {
    return (
        left?.type === "UnaryExpression" &&
        left?.operator === "#" &&
        left?.argument?.name === name &&
        right?.type === "NumericLiteral" &&
        right?.value === 1
    );
}
function isTableInsert(ast) {
    if (ast.type !== "AssignmentStatement") {
        return;
    }
    if (ast.variables?.length !== 1 || ast.variables[0]?.type !== "IndexExpression") {
        return;
    }
    let index = ast.variables[0]?.index;
    if (!index) {
        return;
    }
    if (index.type !== "BinaryExpression" || index.operator !== "+") {
        return;
    }
    let basename = ast.variables[0]?.base?.name;
    if (!basename) {
        return;
    }
    return isIndexPlusOne(index.left, index.right, basename) || isIndexPlusOne(index.right, index.left, basename);
}
function getLuaStringToken(s) {
    if (s[0] == "[") {
        let cut = s.indexOf("[", 1) + 1;
        let start_cut = s[cut] == "\n" ? cut + 1 : cut;
        return s.slice(start_cut, -cut);
    } else {
        return s.slice(1, -1);
    }
}
function luaLiteral2Js(s) {
    let c = s[0];
    s = getLuaStringToken(s);
    if (c == "[") {
        return "`" + s.replace(/\'/g, "\\`") + "`";
    } else {
        return c + s.replace(/\'/g, "\\`") + c;
    }
}
function isReturnNilAndErr(ast) {
    return ast.arguments?.length == 2 && ast.arguments[0].type == "NilLiteral";
}
function luaFormat2JsTemplate(ast) {
    let ret = `l2j.string.format(${ast.arguments[0].raw},`;
    for (let i = 1; i < ast.arguments.length; i++) {
        ret += ast2js(ast.arguments[i]);
        ret += i < ast.arguments.length - 1 ? "," : "";
    }
    ret += ")";
    return ret;

    // let s = getLuaStringToken(ast.arguments[0].raw);

    // let tokens = formatTokenize(s);
    // let ret = "";
    // let argIndex = 0;
    // tokens.forEach((v) => {
    //     if (typeof v === "string") ret += v;
    //     else ret += "${" + ast2js(ast.arguments[argIndex++]) + "}";
    // });
    // // prettier-ignore
    // ret = "`" + ret.replace(/`/g, "\\`").replace(/'/g, "\\'") + "`";
    // return ret;

    // let status = 0;
    // let res = [];
    // let j = 0;
    // for (let i = 0; i < s.length; i++) {
    //     const c = s[i];
    //     if (c === "%") {
    //         if (status === 0) {
    //             status = 1;
    //         } else if (status === 1) {
    //             status = 0;
    //             res.push(c);
    //         }
    //     } else if (c === "s" && status === 1) {
    //         j = j + 1;
    //         res.push("${" + ast2js(ast.arguments[j]) + "}");
    //         status = 0;
    //     } else if (c === "`") {
    //         res.push("\\" + c);
    //     } else {
    //         res.push(c);
    //     }
    // }
    // res = "`" + res.join("").replace(/`/g, "\\`").replace(/'/g, "\\'") + "`";
    // return res;
}
function selfToThis(ast) {
    if (ast.type === "Identifier" && ast.name === "self") {
        ast.name = getThisVarName();
        hasSelfCall = true;
        // if (isInLocalFunction()) localThisArgUsed = true;
    }
}
function clsToThis(ast) {
    if (ast.type === "Identifier" && ast.name === "cls") {
        ast.name = getThisVarName();
        hasSelfCall = true;
        // if (isInLocalFunction()) localThisArgUsed = true;
    }
}
function smartPack(args) {
    switch (args.length) {
        case 0:
            return "";
        case 1:
            if (args[0].type === "VarargLiteral") {
                return "[...varargs]";
            } else {
                return ast2js(args[0]);
            }
        default:
            return `[${ast2js(args, ", ")}]`;
    }
}
function tagVarargAsSpread(args) {
    if (args.length === 0) {
        return args;
    }
    let last = args[args.length - 1];
    if (last.type === "VarargLiteral") {
        last.asSpread = true;
    }
    return args;
}
// {
//           "type": "CallExpression",
//           "base": {
//             "type": "Identifier",
//             "name": "select"
//           },
//           "arguments": [
//             {
//               "type": "StringLiteral",
//               "value": null,
//               "raw": "\"#\""
//             },
//             {
//               "type": "VarargLiteral",
//               "value": "...",
//               "raw": "..."
//             }
//           ]
//         }
function isSelectLength(node) {
    return (
        node.base?.name == "select" &&
        node.arguments.length == 2 &&
        node.arguments[0]?.raw?.slice(1, -1) == "#" &&
        node.arguments[1]?.type == "VarargLiteral"
    );
}
// {
//           "type": "CallExpression",
//           "base": {
//             "type": "Identifier",
//             "name": "select"
//           },
//           "arguments": [
//             {
//               "type": "NumericLiteral",
//               "value": 1,
//               "raw": "1"
//             },
//             {
//               "type": "VarargLiteral",
//               "value": "...",
//               "raw": "..."
//             }
//           ]
//         }
function isSelectNumber(node) {
    return (
        node.base?.name == "select" &&
        node.arguments.length == 2 &&
        !(node.arguments[0]?.raw?.slice(1, -1) == "#") &&
        node.arguments[1]?.type == "VarargLiteral"
    );
}

function isClassDeclare(ast) {
    return (
        ast.variables.length == 1 &&
        ast.init.length == 1 &&
        (ast.init[0].type == "TableCallExpression" || ast.init[0].type == "CallExpression") &&
        ast.init[0].base?.name == "class"
    );
}

function verifyMultiReturnFunction(scopePrefix, vars, init) {
    for (let [k, returnCount] of LUA_MULTI_RETURN_FUNC) {
        if (init.indexOf(k) >= 0) {
            if (!vars.startsWith("[")) {
                init = init + "[0]";
            } else if (vars.endsWith("]")) {
                let args = vars.substring(1, vars.length - 1).split(",");
                if (args.length < returnCount) {
                    vars = "[";
                    for (let i = 0; i < returnCount; ++i) {
                        vars += i < args.length ? args[i] : `_${argIndex++}`;
                        if (i < returnCount - 1) vars += ",";
                    }
                    vars += "]";
                }
            }
            break;
        }
    }

    let ret;
    if (scopePrefix.length === 0) {
        ret = `${vars} = ${init}`;
        // 如果是xxx.xxx = (xxx, xxx) = > { xxx } 的形式，那么改成xxx.constructor.prototype.xxx = function (xxx, xxx) { xxx }
        // Match pattern: object.property = (params) => { body }
        const arrowFunctionPattern = /^(\w+)\.(\w+)\s*=\s*\((.*?)\)\s*=>\s*(\{[\s\S]*\})$/;
        if (arrowFunctionPattern.test(ret)) {
            const match = ret.match(arrowFunctionPattern);
            if (match) {
                let [, objectName, methodName, params, functionBody] = match;
                params = params.replace("self,", "").replace("this,", "");
                ret = `${objectName}.constructor.prototype.${methodName} = function (${params}) ${functionBody}`;
            }
        }
    } else {
        ret = `${scopePrefix}${vars} = ${init}`;
    }

    return ret;
}

function ast2js(ast, joiner) {
    astStack.push(ast);
    // console.log(JSON.stringify(ast, undefined, 4));
    let ret = "";
    ret += processBeforeAst2Js(ast);
    ret += ast2jsImp(ast, joiner);
    ret += processAfterAst2Js(ast);
    astStack.pop();
    return ret;
}
function isTopScope() {
    return astStack.length <= 3;
}

function ast2jsImp(ast, joiner) {
    try {
        if (ast instanceof Array) {
            return ast.map(ast2js).join(joiner || ";\n");
        }
        switch (ast.type) {
            case "Chunk":
                ast.body.forEach((e) => {
                    if (e.type == "ReturnStatement") {
                        e.asExport = true;
                    }
                });
                return ast2js(ast.body);
            case "Identifier":
                return toCamel(IdentifierMap[ast.name] || ast.name);
            case "BreakStatement":
                return "break";
            case "DoStatement":
                return `{${ast2js(ast.body)}}`;
            case "AssignmentStatement":
            case "LocalStatement":
                let duplicatedDeclare = false;
                if (ast.type === "LocalStatement") {
                    duplicatedDeclare = ast.duplicated;
                    for (let varIndex = 0; varIndex < ast.variables.length; ++varIndex) {
                        let name = ast.variables[varIndex].name;
                        for (let i = localVarStacks.length - 1; i >= 0; i--) {
                            if (localVarStacks[i].has(name)) {
                                if (name === "_") {
                                    ast.variables[varIndex].name = `_${varIndex}`;
                                } else {
                                    duplicatedDeclare = true;
                                    break;
                                }
                            }
                        }
                        if (!duplicatedDeclare) localVarStacks[localVarStacks.length - 1].add(name);
                    }
                }
                if (isCustomLuaClassLocalDefine(ast)) {
                    return convertCustomLuaClassFunc(ast);
                }
                if (isClassDeclare(ast)) {
                    ast.init[0].className = toCamel(ast.variables[0].name);
                    return ast2js(ast.init[0]);
                }
                if (isTableInsert(ast)) {
                    // return `${ast2js(ast.variables[0].base)}.push(${ast2js(ast.init)})`;
                    return `l2j.table.insert(${ast2js(ast.variables[0].base)}, ${ast2js(ast.init)})`;
                }
                let init0;
                let scopePrefix = ast.type === "LocalStatement" ? "let " : "";
                if (duplicatedDeclare) {
                    if (ast.variables.length === 1) scopePrefix = "";
                    else
                        console.error(
                            `duplicated declare ${ast2js(ast.variables)
                                .replaceAll(";", ", ")
                                .replaceAll("\n", "")} in ${sourceFilePath}`
                        );
                }

                let vars = smartPack(ast.variables);
                switch (ast.init.length) {
                    case 0:
                        return `${scopePrefix}${ast2js(ast.variables, ", ")}`;
                    case 1:
                        init0 = ast2js(ast.init[0]);
                        let needCreateClass = false;
                        // if (!isLocalVar(v)) scopePrefix = `globalThis.`;
                        if (
                            (l2jGlobalVars.has(vars) || LUA_META_CALLER.has(vars)) &&
                            !LUA_GLOBAL_LIB.has(vars) &&
                            !LUA_GLOBAL_LIB.has(init0) &&
                            vars !== init0 &&
                            !isFunctionParameter(vars)
                        ) {
                            scopePrefix = `globalThis.`;
                            needCreateClass = init0.indexOf("l2j.require") < 0;

                            // if (value.indexOf("l2j.require") >= 0) {
                            //     // require出来的直接赋值
                            //     scopePrefix = `globalThis.`;
                            // } else {
                            //     if (globalVarNeedDefine !== undefined)
                            //         throw new Error(
                            //             "duplicated global var inited: " + v + " and " + globalVarNeedDefine + ""
                            //         );
                            //     globalVarNeedDefine = v;
                            //     scopePrefix = "let ";
                            // }
                            // if (l2jInitedGlobalVars.has(v)) throw new Error(`duplicated global var inited: ${v}`);
                            l2jInitedGlobalVars.add(vars);
                        }

                        if (LUA_SYSTEM_LIB.has(init0)) {
                            init0 = `l2j.${init0}`;
                        }

                        // 如果文件名和定义的local名一样，则认为是class
                        let fileName = currentFileName;
                        if (
                            vars === "M" ||
                            vars == fileName ||
                            needCreateClass
                            // !hasModuleDefined) ||
                        ) {
                            hasModuleDefined = true;
                            if (
                                !isTopScope() ||
                                init0.startsWith("CS.") ||
                                init0.startsWith("Tweening.") ||
                                init0 === "M" ||
                                init0.startsWith("setmetatable") ||
                                (init0 === fileName && vars === "M") ||
                                init0 === `undefined`
                            ) {
                                return `${scopePrefix}${vars} = ${init0}`;
                            } else {
                                declaredClasses.add(vars);
                                return `${scopePrefix}${vars} = l2j.createClass(${init0})`;
                            }
                        } else {
                            if ((LUA_GLOBAL_LIB.has(init0) || init0 === vars) && !isFunctionParameter(init0)) {
                                init0 = `globalThis.${init0}`;
                            } else if (init0.startsWith("l2j.string.find")) {
                                if (!vars.startsWith(`[`)) vars = `[${vars}]`;
                                init0 = init0.replace(`l2j.string.find`, `l2j.string.findWithRet`);
                            }
                        }
                        // return `${scopePrefix}${vars} = ${init0}`;
                        return verifyMultiReturnFunction(scopePrefix, vars, init0);
                    default:
                        tagVarargAsSpread(ast.init);
                        let init = smartPack(ast.init).replace(`l2j.string.find`, `l2j.string.findWithRet`);
                        // if (LUA_GLOBAL_LIB.has(init0)) init0 = `globalThis.${init}`;
                        // return `${scopePrefix}${vars} = ${init}`;
                        return verifyMultiReturnFunction(scopePrefix, vars, init);
                }
            case "UnaryExpression":
                let exp = ast2js(ast.argument);
                switch (ast.operator) {
                    case "not":
                        return `!${exp}`;
                    case "#":
                        // return `(${exp}).length`;
                        return `l2j.table.length(${exp})`;
                    default:
                        // lch begin
                        let funcName = verifyUnaryExpression(ast.operator);
                        if (funcName) return `${funcName}(${exp})`;
                        // lch end
                        return `${ast.operator}${exp}`;
                }
            case "BinaryExpression":
                // lch begin
                let funcName = verifyBinaryExpression(ast, binaryOpMap[ast.operator] || ast.operator);
                if (funcName) return `${funcName}(${ast2js(ast.left)}, ${ast2js(ast.right)})`;
                // lch end

                ast.left.isBinaryExpressionMode = true;
                ast.right.isBinaryExpressionMode = true;
                return `(${ast2js(ast.left)} ${binaryOpMap[ast.operator] || ast.operator} ${ast2js(ast.right)})`;
            case "BooleanLiteral":
                return ast.raw;
            case "NumericLiteral":
                return ast.value;
            case "StringLiteral":
                if (ast.isBinaryExpressionMode && getLuaStringToken(ast.raw) === "table") {
                    return '"object"';
                } else {
                    return luaLiteral2Js(ast.raw);
                }
            case "NilLiteral":
                return "undefined";
            case "VarargLiteral":
                return ast.asSpread ? "...varargs" : ast.asArray ? "[...varargs]" : "varargs[0]";
            case "LogicalExpression":
                let op = ast.operator;
                if (op === "or" && ast.left?.operator === "and" && ast.right?.type !== "LogicalExpression") {
                    return `(l2j.condition(${ast2js(ast.left.left)}) ? (${ast2js(ast.left.right)}): (${ast2js(
                        ast.right
                    )}))`;
                }

                let replacedFuncName = verifyLogicExpression(ast, binaryOpMap[ast.operator] || ast.operator);
                if (replacedFuncName) {
                    let left = ast2js(ast.left);
                    let right = ast2js(ast.right);
                    if (op === "and") {
                        return `(l2j.condition(${left}) ? ${right} : ${left})`;
                    } else if (op === "or") {
                        return `(l2j.condition(${left}) ? ${left} : ${right})`;
                    }
                    // return `${replacedFuncName}(${ast2js(ast.left)}, ${ast2js(ast.right)})`;
                }

                return `(${ast2js(ast.left)} ${binaryOpMap[ast.operator] || ast.operator} ${ast2js(ast.right)})`;
            case "TableConstructorExpression":
                if (ast.isClassMode) {
                    for (const field of ast.fields) {
                        if (field.type === "TableKeyString") {
                            if (field.value.type !== "TableConstructorExpression") {
                                field.isClassMode = true;
                                field.value.isClassMode = true;
                            } else {
                                field.isClassMode = true;
                            }
                        } else {
                        }
                    }
                    return `{${ast2js(ast.fields, "\n")}}`;
                } else if (ast.fields.length === 0) {
                    // try guess from later code whether contains t[#t+1] or table.concat(t)
                    // return '[]'
                    return "{}";
                } else {
                    let is_pure_array = ast.fields.every((e) => e.type == "TableValue");
                    // if(!is_pure_array) ast.field.every((e)=>e.type === "TableKey" && e.type === "")
                    if (is_pure_array) {
                        tagVarargAsSpread(ast.fields.map((e) => e.value));

                        let ret = "{";
                        for (let i = 0; i < ast.fields.length; ++i) {
                            let value = ast2js(ast.fields[i]);
                            if (value.indexOf("...") !== -1)
                                return `l2j.convertJsArrayToLuaTable([${ast2js(ast.fields, ", ")}])`;
                            ret += `${i + 1}: (${value}),`;
                        }
                        ret += "}";
                        return ret;
                        // return `[${ast2js(ast.fields, ", ")}]`;
                    } else {
                        // return `{${ast2js(ast.fields, ", ")}}`;
                        let types = new Set();
                        ast.fields.forEach((e) => types.add(e.type));
                        if (types.size === 1) return `{${ast2js(ast.fields, inClassKeyDefined() ? ";" : ", ")}}`;
                        else {
                            let ret = "{";
                            for (let i = 0; i < ast.fields.length; ++i) {
                                if (ast.fields[i]?.type === "TableValue") {
                                    ret += `${i + 1}: ${ast2js(ast.fields[i].value)}`;
                                } else {
                                    ret += ast2js(ast.fields[i]);
                                }
                                ret += i < ast.fields.length - 1 ? "," : "";
                            }
                            ret += "}";
                            return ret;
                        }
                    }
                }
            case "TableKeyString":
                if (ast.isClassMode) {
                    if (ast.value.type == "FunctionDeclaration") {
                        ast.value.identifier = {
                            type: "Identifier",
                            name: ast.key.name,
                        };
                        return `${ast2js(ast.value)}`;
                    } else {
                        return `${ast2js(ast.key)} = ${ast2js(ast.value)}`;
                    }
                } else {
                    return `${ast2js(ast.key)}${inClassKeyDefined() ? "=" : ":"} ${ast2js(ast.value)}`;
                }
            case "TableKey":
                return `[${ast2js(ast.key)}]: ${ast2js(ast.value)}`;
            case "TableValue":
                return ast2js(ast.value);
            case "IndexExpression":
                // if (ast.index?.type == "NumericLiteral" && ast.index.value >= 1) {
                //     ast.index.value = ast.index.value - 1;
                //     return `${ast2js(ast.base)}[${ast2js(ast.index)}]`;
                // } else {
                return `${ast2js(ast.base)}[${ast2js(ast.index)}]`;
            // }

            case "IfStatement":
                return ast.clauses.map(ast2js).join("\n");
            case "IfClause":
                return `if (${ast2js(ast.condition)}) {${ast2js(ast.body)}}`;
            case "ElseClause":
                return `else {${ast.body.map(ast2js).join(";")}}`;
            case "ElseifClause":
                return `else if (${ast2js(ast.condition)}) {${ast2js(ast.body)}}`;
            case "FunctionDeclaration":
                if (isTopScope()) hasSelfCall = false;
                // if (!isInLocalFunction()) localThisArgUsed = false;
                tagVarargAsSpread(ast.parameters);
                if (ast.isClassMode) {
                    // let firstParamsName = ast.parameters[0]?.name;
                    // switch (firstParamsName) {
                    //     case "self":
                    //         traverseAst(ast.body, selfToThis);
                    //         return `${ast2js(ast.identifier)}(${ast2js(ast.parameters.slice(1), ", ")}) {${ast2js(
                    //             ast.body
                    //         )}}`;
                    //     case "cls":
                    //         traverseAst(ast.body, clsToThis);
                    //         return `static ${ast2js(ast.identifier)}(${ast2js(
                    //             ast.parameters.slice(1),
                    //             ", "
                    //         )}) {${ast2js(ast.body)}}`;
                    //     default:
                    //         return `${ast2js(ast.identifier)}(${ast2js(ast.parameters, ", ")}) {${ast2js(ast.body)}}`;
                    // }
                    if (ast.identifier?.type == "MemberExpression") {
                        traverseAst(ast.body, selfToThis);
                        let ret = "";

                        if (ast.identifier?.indexer == ":") {
                            ret = `${ast2js(ast.identifier.identifier)}(${ast2js(ast.parameters, ",")}) {`;
                        } else if (ast.identifier?.indexer == ".") {
                            ret = `static ${ast2js(ast.identifier.identifier)}(${ast2js(ast.parameters, ",")}) {`;
                        }

                        let body = ast2js(ast.body);
                        // if (localThisArgUsed) ret += ";let thisArg = this;";
                        return ret + body + "}";
                    } else {
                        throw new Error(`unexpected ast.identifier?.type: ${ast.identifier?.type}`);
                    }
                } else {
                    if (
                        ast.identifier?.type == "MemberExpression" &&
                        ast.identifier?.indexer == "." &&
                        ast.parameters[0]?.name == "self"
                    ) {
                        ast.identifier.base = insertPrototypeNode(ast.identifier.base);
                        ast.parameters = ast.parameters.slice(1);
                        traverseAst(ast.body, selfToThis);
                    } else if (ast.identifier?.type == "MemberExpression" && ast.identifier?.indexer == ":") {
                        ast.identifier.base = insertPrototypeNode(ast.identifier.base);
                        traverseAst(ast.body, selfToThis);
                    } else if (
                        ast.identifier?.type == "MemberExpression" &&
                        ast.identifier?.indexer == "." &&
                        ast.parameters[0]?.name == "cls"
                    ) {
                        ast.parameters = ast.parameters.slice(1);
                        traverseAst(ast.body, clsToThis);
                    }

                    ast.parameters.forEach((v) => {
                        localVarStacks[localVarStacks.length - 1].add(v.name);
                    });

                    let args = ast.parameters.map(ast2js).join(", ");
                    let body = ast2js(ast.body);
                    let main;

                    if (isTopScope() && hasSelfCall) {
                        // if (localThisArgUsed) {
                        // 处理this在回调中引用的问题，在js中回调里引的this不对
                        // main = `(${args}){let thisArg = this;\n${body}}`;
                        main = `function (${args}){${body}}`;
                        localThisArgUsed = false;
                    } else {
                        main = `(${args}) => {${body}}`;
                    }

                    if (isTopScope()) hasSelfCall = false;

                    // `(${args}){${body}}`;
                    if (ast.identifier == null) {
                        return main;
                    } else {
                        let fnName = ast2js(ast.identifier);
                        if (ast.identifier?.type == "MemberExpression") {
                            // return `${fnName} = function ${main}`;
                            // 箭头函数
                            return `${fnName} = ${main}`;
                        } else {
                            // return `${ast.isLocal ? "let " : ""} ${fn_name} = function ${fn_name}${main}`;
                            let ret = `${fnName} = ${main}`;
                            if (!ast.isLocal) {
                                ret += `\n_G.${fnName} = ${fnName};\n`;
                            }
                            return ret;
                        }
                    }
                }
            case "MemberExpression":
                // let hide_self = ast.indexer == ":";
                let base = ast2js(ast.base);
                let identifier = ast2js(ast.identifier);
                if (LUA_SYSTEM_LIB.has(base)) return `l2j.${base}.${identifier}`;
                return `${base}.${identifier}`;

            case "ReturnStatement":
                if (isReturnNilAndErr(ast)) {
                    return `throw new Error(${ast2js(ast.arguments[1])})`;
                }
                tagVarargAsSpread(ast.arguments);
                if (ast.asExport) {
                    // lch begin
                    // 处理class
                    let ret = "";
                    for (let c of declaredClasses) {
                        ret += `l2j.finishClass(${c});\n`;
                    }
                    // lch end

                    if (exportAsESM) {
                        return ret + `export default ${smartPack(ast.arguments)}`;
                    } else {
                        return ret + `exports.default = ${smartPack(ast.arguments)}`;
                    }
                } else {
                    return `return ${smartPack(ast.arguments)}`;
                }

            case "CallStatement":
                return ast2js(ast.expression);
            case "CallExpression":
                if (isCustomClassCall(ast)) {
                    return convertCustomClassCall(ast);
                } else if (ast.base.type == "Identifier" && ast.base.name == "class" && ast.className) {
                    ast.arguments[0].isClassMode = true;
                    const extendsToken = ast.arguments.length == 1 ? "" : "extends " + ast2js(ast.arguments[1]);
                    return `class ${ast.className} ${extendsToken} ${ast2js(ast.arguments[0])}`;
                } else if (isClassExtends(ast)) {
                    let [cls, pcls] = ast.arguments;
                    cls.isClassMode = true;
                    return `class ${ast2js(cls)} extends ${ast2js(pcls)}`;
                } else if (isSelectLength(ast)) {
                    return `varargs.length`;
                } else if (isSelectNumber(ast)) {
                    return `varargs[${ast2js(ast.arguments[0])}]`;
                } else if (isStringFormatCall(ast)) {
                    return luaFormat2JsTemplate(ast);
                } else if (isErrorCall(ast)) {
                    return luaError2JsThrow(ast);
                } else if (isTableInsertCall(ast)) {
                    return luaInsert2JsPush(ast);
                } else if (isTableInsertAtHeadCall(ast)) {
                    return luaInsert2JsUnshift(ast);
                } else if (isTableConcatCall(ast)) {
                    return luaConcat2JsJoin(ast);
                    // } else if (isAssertCall(ast)) {
                    //   return luaAssert2JsIfThrow(ast);
                } else if (isTypeCall(ast)) {
                    return luaType2JsTypeof(ast);
                } else if (isLuaSystemFunc(ast)) {
                    return convertLuaSystemFunc(ast);
                } else if (isLuaRequireFunc(ast)) {
                    return convertLuaRequireFunc(ast);
                } else if (ast.arguments[0]?.name == getThisVarName()) {
                    tagVarargAsSpread(ast.arguments);
                    let rest = ast.arguments.slice(1);

                    if (l2jGlobalVars.has(ast.base.base?.name)) {
                        return `${ast2js(ast.base)}(${getThisVarName()}${rest.length > 0 ? ", " : ""}${rest
                            .map(ast2js)
                            .join(", ")})`;
                    }

                    if (ast.base.base) {
                        ast.base.base = {
                            type: "MemberExpression",
                            indexer: ".",
                            identifier: {
                                type: "Identifier",
                                name: "prototype",
                            },
                            base: ast.base.base,
                        };
                    }
                    hasSelfCall = true;
                    let firstArg = "";
                    let funcName = ast2js(ast.base);
                    // if (isInLocalFunction()) localThisArgUsed = true;
                    if (ast.base.indexer === ":") {
                        // let isGlobalCall = false;
                        // for (let v of l2jGlobalVars) {
                        //     if (funcName.startsWith(v)) {
                        //         isGlobalCall = true;
                        //         break;
                        //     }
                        // }
                        // if (!isGlobalCall && !funcName.startsWith("this.") && !funcName.startsWith("thisArg.")) {
                        //     // 第一个参数是self的，如果是成员函数, 比如base:xxx(self,1,2,3)这种需要翻译成this.xxx(this, 1,2,3)
                        //     return `${getThisVarName()}.${funcName}(${firstArg}${getThisVarName()}${
                        //         rest.length > 0 ? ", " : ""
                        //     }${rest.map(ast2js).join(", ")})`;
                        // } else {
                        let addThisArg = false;
                        for (let v of LUA_DYNAMIC_STATIC_FUNCTION_KEY) {
                            if (funcName.indexOf(v) > 0) {
                                addThisArg = true;
                                break;
                            }
                        }
                        if (addThisArg) {
                            return `${funcName}.call(${getThisVarName()}${rest.length > 0 ? ", " : ""}${rest
                                .map(ast2js)
                                .join(", ")})`;
                        } else {
                            let args = ast.arguments.map(ast2js).join(", ");
                            if (args.startsWith("this,")) args = args.substring(5);
                            return `${funcName.replaceAll("prototype.", "")}(${args})`;
                        }
                        // }
                    } else {
                        let needAddCall = funcName.indexOf("prototype") >= 0;
                        for (let [key, v] of LUA_REMOVE_PROTOTYPE_KEY)
                            if (funcName.indexOf(key) > 0) {
                                funcName = funcName.replaceAll(".prototype", "");
                                needAddCall = v;
                                break;
                            }
                        if (needAddCall) {
                            return `${funcName}.call(${getThisVarName()}${rest.length > 0 ? ", " : ""}${rest
                                .map(ast2js)
                                .join(", ")})`;
                        }
                        // return `${ast2js(ast.base)}.call(${getThisVarName()}${
                        //     rest.length > 0 ? ", " : ""
                        // }${rest.map(ast2js).join(", ")})`;
                        // // 这里并不知道掉的是成员函数还是静态函数，所以只能运行时判断，运行时要根据是否是成员函数吃掉第一个参数
                        // return `l2j.callFunc(${ast2js(ast.base)}${ast.arguments.length > 0 ? "," : ""}${ast.arguments
                        //     .map(ast2js)
                        //     .join(", ")})`;
                        return `${funcName}(${getThisVarName()}${rest.length > 0 ? ", " : ""}${rest
                            .map(ast2js)
                            .join(", ")})`;
                    }
                } else if (ast.base.type === "Identifier" && LUA_META_CALLER.has(ast.base.name)) {
                    tagVarargAsSpread(ast.arguments);
                    // return `${ast2js(ast.base)}.__call({}, ${ast.arguments.map(ast2js).join(", ")})`;
                    return `new CS.UnityEngine.${ast2js(ast.base)}(${ast.arguments.map(ast2js).join(", ")})`;
                } else if (ast.base.type === "Identifier" && ast.base.name === "assert") {
                    tagVarargAsSpread(ast.arguments);
                    return `l2j.${ast2js(ast.base)}(${ast.arguments.map(ast2js).join(", ")})`;
                } else {
                    tagVarargAsSpread(ast.arguments);
                    let funcName = ast2js(ast.base);
                    let addCall = funcName.indexOf("prototype") >= 0;
                    if (!addCall) {
                        for (let v of LUA_ADD_CALL_KEY) {
                            if (funcName.indexOf(v) >= 0) {
                                addCall = true;
                                break;
                            }
                        }
                    }

                    let body = ast.arguments.map(ast2js).join(", ");
                    // let firstArgType = ast.arguments.length > 0 ? ast.arguments[0].type : undefined;
                    if (addCall) {
                        return `${funcName}.call(${body})`;
                    } else {
                        return `${funcName}(${body})`;
                    }
                    // if (
                    //     funcName.startsWith("CS.") ||
                    //     ast.arguments.length === 0 ||
                    //     ast.base.indexer === ":" ||
                    //     LUA_GLOBAL_LIB.has(funcName) ||
                    //     l2jGlobalVars.has(funcName) ||
                    //     firstArgType === "StringLiteral" ||
                    //     firstArgType === "NumericLiteral" ||
                    //     firstArgType === "NilLiteral" ||
                    //     firstArgType === "BooleanLiteral" ||
                    //     firstArgType === "TableConstructorExpression" ||
                    //     body.startsWith("CS.") ||
                    //     body.startsWith("l2j.")
                    // ) {
                    //     return `${funcName}(${body})`;
                    // } else {
                    //     // 这里并不知道掉的是成员函数还是静态函数，所以只能运行时判断
                    //     return `l2j.callFunc(${funcName}, ${body})`;
                    // }
                }
            case "TableCallExpression":
                if (ast.base.type == "Identifier" && ast.base?.name == "class") {
                    ast.arguments.isClassMode = true;
                    if (ast.className) {
                        return `class ${ast.className} ${ast2js(ast.arguments)}`;
                    } else {
                        return `class ${ast2js(ast.arguments)}`;
                    }
                } else {
                    return `${ast2js(ast.base)}(${ast2js(ast.arguments)})`;
                }

            case "StringCallExpression":
                return `${ast2js(ast.base)}(${ast2js(ast.argument)})`;
            case "ForNumericStatement":
                let oldReplaceOperatorToFunc = replaceOperatorToFunc;
                replaceOperatorToFunc = false;
                let v = ast2js(ast.variable);
                let step = ast.step == null ? 1 : ast2js(ast.step);
                let start = ast2js(ast.start);
                let compare_op;
                if (start === 1) {
                    start = 0;
                    compare_op = step < 0 ? ">" : "<";
                } else {
                    compare_op = step < 0 ? ">=" : "<=";
                }
                let end = ast2js(ast.end);
                replaceOperatorToFunc = oldReplaceOperatorToFunc;
                return `for (let ${v}=${start}; ${v} ${compare_op} ${end}; ${v}=${v}+${step}) {${ast2js(ast.body)}}`;
            case "ForGenericStatement":
                let iter;
                if (ast.iterators.length == 1) {
                    let iter_name = ast.iterators[0].base?.name;
                    if (iter_name == "ipairs") {
                        // iter = `${ast2js(ast.iterators[0].arguments)}.entries()`;
                        iter = `l2j.ipairs(${ast2js(ast.iterators[0].arguments)})`;
                    } else if (iter_name == "pairs") {
                        iter = `l2j.pairs(${ast2js(ast.iterators[0].arguments)})`;
                    } else {
                        iter = ast.iterators.map(ast2js);
                    }
                } else {
                    iter = ast.iterators.map(ast2js);
                }
                return `for (let ${smartPack(ast.variables)} of ${iter}) {${ast2js(ast.body)}}`;
            case "WhileStatement":
                return `while (${ast2js(ast.condition)}) {${ast2js(ast.body)}}`;
            case "RepeatStatement":
                return `do {${ast2js(ast.body)}} while (${ast2js(ast.condition)})`;
            default:
                throw new Error(`Unsupported AST node type: ${ast.type}`);
        }
    } catch (error) {
        return `[${error.message}]`;
    }
}
function lua2ast(lua_code) {
    try {
        return luaparse.parse(lua_code, LUA_PARSER_OPTIONS);
    } catch (error) {
        return { error: error.message };
    }
}

function lua2js(lua_code, source, asESM) {
    let js = "";
    try {
        scopeStack = [];
        let ast = lua2ast(lua_code);

        // lch begin
        initGlobalVars(source, ast, asESM);
        // lch end

        js = ast2js(ast);

        // if (outsideClassString.length > 0) {
        //     // 在最前面前插入
        //     js = outsideClassString + "\n" + js;
        // }

        return prettier.format(js, { parser: "babel", rules: { "no-debugger": "off" }, plugins: [parserBabel] });
    } catch (error) {
        let ret = `/*\n${error}\n*/\n${js}`;
        console.error(`file: ${source}, error: ${error.message}`);
        return ret;
    }
}

export { lua2ast, lua2js, ast2js, l2jSystemFuncs, l2jGlobalVars, l2jInitedGlobalVars };
