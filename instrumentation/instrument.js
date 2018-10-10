

var fondue = require("../JSAnalyzer/index.js")
// var fondue = require("fondue");
var fs =require("fs")
var path = require("path")
var program = require('commander');
var vm = require('vm');

program
    .version("0.1.0")
    .option("-i, --input [input]","path to the input file")
    .option("-n, --name [name]", "name of the file being instrumented")
    .option("-t , --type [type]", "[HTML | Javascript (js)]", "html")
    .option("--cache-toggle [cacheToggle]" , "Record (0) or replay (1) cache ")
    .parse(process.argv)

/* 
Instrument any scripts tags inside 
HTML pages
*/

function instrumentHTML(src, fondueOptions) {

    // test if the file is html or javascript
    var isHtml;
    try {
        var script = new vm.Script(src);
        isHtml = false;
    } catch (e) {
        isHtml = true;
    }

    if (!isHtml)
        return instrumentJavaScript(src, fondueOptions);
    
    console.log("Instrumenting a html file");
    var scriptLocs = [];
    var scriptBeginRegexp = /<\s*script[^>]*>/ig;
    var scriptEndRegexp = /<\s*\/\s*script/i;
    var lastScriptEnd = 0;

    var match;
    while (match = scriptBeginRegexp.exec(src)) {
        var scriptBegin = match.index + match[0].length;
        if (scriptBegin < lastScriptEnd) {
            continue;
        }
        var endMatch = scriptEndRegexp.exec(src.slice(scriptBegin));
        if (endMatch) {
            var scriptEnd = scriptBegin + endMatch.index;
            scriptLocs.push({ start: scriptBegin, end: scriptEnd });
            lastScriptEnd = scriptEnd;
        }
    }
    // console.log("The location of scripts in html: " + JSON.stringify(scriptLocs));
    // process the scripts in reverse order
    for (var i = scriptLocs.length - 1; i >= 0; i--) {
        var loc = scriptLocs[i];
        var script = src.slice(loc.start, loc.end);
        // console.log("Script to be instrumented: " + script)
        var options = mergeInto(fondueOptions, {});
        options.path = options.path + "-script-" + i;
        var prefix = src.slice(0, loc.start).replace(/[^\n]/g, " "); // padding it out so line numbers make sense
        // console.log("Instrumenting " + JSON.stringify(loc));
        src = src.slice(0, loc.start) + instrumentJavaScript(prefix + script, options, true) + src.slice(loc.end);
        // console.log("And the final src is :" + src)
    }

    // remove the doctype if there was one (it gets put back below)
    var doctype = "";
    // var doctypeMatch = /^(<!doctype[^\n]+\n)/i.exec(src);
    var doctypeMatch = /^(<!DOCTYPE[ ]+([^ ][^>]+[^ />]+)[ /]*>)/i.exec(src)
    if (doctypeMatch) {
        doctype = doctypeMatch[1];
        src = src.slice(doctypeMatch[1].length);
    }
    // console.log("The doctype was:" + doctype)
    // assemble!
    src = doctype + "\n<script>\n" + fondue.instrumentationPrefix(fondueOptions) + "\n</script>\n" + src;
    // console.log("ANd the ultimately final source being" + src)
    return src;
}


function instrumentJavaScript(src, fondueOptions, jsInHTML) {
    console.log("Instrumenting a js file")
    var fondueOptions = mergeInto({include_prefix: false}, fondueOptions);
    src = src.replace(/^\s+|\s+$/g, '');
    if (jsInHTML){
        // console.log("Instrumenting a snippet of js: ");
    }
    src = fondue.instrument(src, fondueOptions).toString();
    // console.log("After instrumentation the source becomes: ");
    return src;
}

function mergeInto(options, defaultOptions) {
    for (var key in options) {
        if (options[key] !== undefined) {
            defaultOptions[key] = options[key];
        }
    }
    return defaultOptions;
}

//Required for the fondue library, to determine how to instrument
var fondueOptions = mergeInto({}, {useProxy: true, caching: false,  include_prefix: false, path: program.name, e2eTesting: false, execution_cache_toggle: parseInt(program.cacheToggle) });

src = fs.readFileSync(program.input,"utf-8")

filename = path.basename(program.input)

if (program.type == "js"){
    src = instrumentJavaScript(src, fondueOptions, false)
    // src = src
} else {
    src = instrumentHTML(src, fondueOptions)
    // src = src
}

fs.writeFileSync(program.input, src)
