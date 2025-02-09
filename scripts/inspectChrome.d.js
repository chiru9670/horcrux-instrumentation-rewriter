var Chrome = require('chrome-remote-interface');
var chromeLauncher = require('chrome-launcher');
var {spawnSync} = require('child_process');
var fs = require('fs')
var mkdirp = require('mkdirp')
var program = require('commander')
var customCodes = require('./custom.js');
var chromeUserDir = "CHROME_USER_DIR";
//var TRACE_CATEGORIES = ["Blob","FileSystem","IndexedDB","ServiceWorker","ValueStoreFrontend::Backend","WebCore,benchmark,rail","audio","benchmark","benchmark,latencyInfo,rail","benchmark,rail","blink","blink,benchmark","blink,benchmark,rail,disabled-by-default-blink.debug.layout","blink,blink_style","blink,devtools.timeline","blink,loader","blink,loading","blink,rail","blink.animations,devtools.timeline,benchmark,rail","blink.console","blink.net","blink.user_timing","blink.user_timing,rail","blink_gc","blink_gc,devtools.timeline","browser","browser,navigation","browser,startup","cc","cc,benchmark","cc,disabled-by-default-devtools.timeline","cdp.perf","content","devtools","devtools.timeline","devtools.timeline,rail","devtools.timeline,v8","devtools.timeline.async","disabled-by-default-blink.debug","disabled-by-default-blink.debug.layout","disabled-by-default-blink.debug.layout.trees","disabled-by-default-blink.feature_usage","disabled-by-default-blink.image_decoding","disabled-by-default-blink.invalidation","disabled-by-default-blink_gc","disabled-by-default-cc.debug","disabled-by-default-cc.debug,disabled-by-default-cc.debug.quads,disabled-by-default-devtools.timeline.layers","disabled-by-default-cc.debug.cdp-perf","disabled-by-default-cc.debug.display_items","disabled-by-default-cc.debug.display_items,disabled-by-default-cc.debug.picture,disabled-by-default-devtools.timeline.picture","disabled-by-default-cc.debug.overdraw","disabled-by-default-cc.debug.quads","disabled-by-default-cc.debug.scheduler","disabled-by-default-cc.debug.scheduler.frames","disabled-by-default-cc.debug.scheduler.now","disabled-by-default-cc.debug.triangles","disabled-by-default-compositor-worker","disabled-by-default-devtools.timeline","disabled-by-default-devtools.timeline.frame","disabled-by-default-devtools.timeline.invalidationTracking","disabled-by-default-file","disabled-by-default-gpu.debug","disabled-by-default-gpu.device","disabled-by-default-gpu.service","disabled-by-default-gpu_decoder","disabled-by-default-ipc.flow","disabled-by-default-loading","disabled-by-default-memory-infra","disabled-by-default-net","disabled-by-default-network","disabled-by-default-renderer.scheduler","disabled-by-default-renderer.scheduler.debug","disabled-by-default-skia","disabled-by-default-skia.gpu","disabled-by-default-skia.gpu.cache","disabled-by-default-system_stats","disabled-by-default-toplevel.flow","disabled-by-default-v8.compile","disabled-by-default-v8.cpu_profiler","disabled-by-default-v8.cpu_profiler.hires","disabled-by-default-v8.gc","disabled-by-default-v8.gc_stats","disabled-by-default-v8.ic_stats","disabled-by-default-v8.runtime","disabled-by-default-v8.runtime_stats","disabled-by-default-v8.runtime_stats_sampling","disabled-by-default-worker.scheduler","disabled-by-default-worker.scheduler.debug","gpu","gpu,startup","identity","input","input,benchmark","input,benchmark,devtools.timeline","input,benchmark,rail","input,rail","io","ipc","ipc,toplevel","leveldb","loader","loading","loading,devtools.timeline","loading,rail,devtools.timeline","media","mojom","navigation","navigation,benchmark,rail","navigation,rail","net","netlog","omnibox","rail","renderer","renderer,benchmark,rail","renderer.scheduler","renderer_host","renderer_host,navigation","sandbox_ipc","service_manager","shutdown","skia","startup","startup,benchmark,rail","startup,rail","task_scheduler","test_gpu","test_tracing","ui","v8","v8,devtools.timeline","v8.execute","views","viz"];

var TRACE_CATEGORIES = ["-*", "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "toplevel", "blink.console", "disabled-by-default-devtools.timeline.stack", "disabled-by-default-devtools.screenshot", "disabled-by-default-v8.cpu_profile", "disabled-by-default-v8.cpu_profiler", "disabled-by-default-v8.cpu_profiler.hires"];


console.log(process.argv);

program
    .option('-u, --url [url] ','the url to replay')
    .option('-l, --launch' , 'launch chrome')
    .option('-o, --output [output]',' the path to the output directory')
    .option('-j, --js-profiling','enable js profiling of the webpages')
    .option('-plt', 'extract page load time')
    .option('-t, --tracing','extract tracing information')
    .option('-c, --custom', 'extract custom information')
    .option('-p,--port [port]', 'port for chrome')
    .option('--log', 'extract console log')
    .option('--coverage', 'extract coverage information')
    .option('-n, --network','extract network information')
    .option('-m, --mobile','running chrome on mobile')
    .option('-e, -error [errpr]','file containing errorous urls')
    .option('--sim [sim]','enable network simulation')
    .option('--mem','extract heap memory trace')
    .option('--testing','testing means dont kill chrome after page load')
    .option('--mode [mode]', "Can be run in record or replay mode or std mode")
    .option('--correctness',"Eval string to check for correctness post replay")
    .parse(process.argv)

pageLoadTime = {}
consoleLog = [];
consoleLog2 = [];
NetworkLog = [];
heapChunks = [];
spinOnCustom = true;
pageLoaded = false;
dataReceived = false;
alldataReceived = false;

evalStringFile = "./EVALFile"


loadErrors = [], fetchErrors = [];

var fatalKill = function(){
    if (program.mobile)
        process.exit();
    else spawnSync("ps aux | grep " +  program.port + " | grep chrom* | awk '{print $2}' | xargs kill -9",{shell:true});
}

var safeKill = function(){
    spawnSync("ps aux | grep " +  program.port + " | grep chrom* | awk '{print $2}' | xargs kill -2",{shell:true});
}

function navigate(launcher){
    let local = false;
    if (program.mobile)
        local = true;
    Chrome({port:Number(program.port), local: local},async function (chrome) {
        try {
            console.log("Connected to remote chrome");
          with (chrome) {
            await Page.enable();
            await Profiler.enable();
            await Runtime.enable();
            await Network.enable();
            await Log.enable();
            // await Debugger.enable();
            // await HeapProfiler.enable();



            Target.attachedToTarget(({sessionId, targetInfo: {url}}) => {
                console.log(`ATTACHED ${sessionId}: ${url}`);
                // enable networks events in this target, you can't use the regular API
                // here, so you have to manually build the messages and take care of
                // ids; it's not really a big deal unless you need to match commands and
                // responses
                Target.sendMessageToTarget({
                    sessionId,
                    message: JSON.stringify({ // <-- a JSON string!
                        id: 1,
                        method: 'Network.enable'
                    })
                });
                Target.sendMessageToTarget({
                    sessionId,
                    message: JSON.stringify({ // <-- a JSON string!
                        id: 2,
                        method: 'Target.setAutoAttach',
                        params: {autoAttach: true, waitForDebuggerOnStart:false}
                    })
                });
            });

            // Target.detachedFromTarget(({sessionId})=>{
            //      console.log(`DETACHED ${sessionId}: ${url}`);
            // })

            Target.receivedMessageFromTarget(({sessionId, message}) => {
                const {id, method, params} = JSON.parse(message); // <-- a JSON string!
                // you can handle massages from the target here; the same apply about
                // the fact that you can't use the regular API here
                // console.log(message);
                switch (method) {
                case 'Network.responseReceived':
                    {
                        // const {request: {url}} = params;
                        // console.log(params)
                        NetworkLog.push(params)
                        break;
                    }
                case "Target.attachedToTarget":{
                    const childSessionId = params.sessionId;
                    console.log("ATTACHED" + childSessionId);
                    Target.sendMessageToTarget({
                        sessionId,
                        message: JSON.stringify({
                            id:3,
                            method: 'Target.sendMessageToTarget',
                            params: {
                                sessionId: childSessionId,
                                message: JSON.stringify({                   
                                    id:1,
                                    method:'Network.enable'  
                                })
                            }
                        })
                    });
                    break;
                }
                case "Target.receivedMessageFromTarget": {
                    const childMsg = JSON.parse(params.message);
                    // console.log(childMsg.method);
                    switch (childMsg.method){
                        case "Network.responseReceived" :{
                            // console.log(childMsg.params.response.url)
                            NetworkLog.push(childMsg.params);
                            break;
                        }
                    }
                    break;
                }
                default:
                    // skip...
                }
            });

            if (program.network){
                await Target.setAutoAttach({autoAttach: true, waitForDebuggerOnStart:false});
                await Network.setCacheDisabled( {"cacheDisabled": true});
            }

            // Target.attachedToTarget((d)=>{
            //     console.log(d.targetInfo);
            // })

            let errFile = null;
            if (program.error){
                errFile = fs.readFileSync(program.error,'utf-8').split('\n');
                if (errFile.indexOf(program.url) >=0 ){
                    console.log("Exiting because this is an errornous url as observed in past");
                    chrome.close();
                    process.exit();
                }
            }
            /*
            Set time out to detect crashes.
            In case of a crash dump whatever information is available, specially crash logs
            */
            var pltTimer;
            if (!program.testing) {
                pltTimer = setTimeout(function(){
                    console.log("Timer fired before site could be loaded");
                    if (program.log) {
                        fs.writeFileSync(program.output + "/logs", JSON.stringify(consoleLog));
                        console.log("Console data logged");
                    };

                    fs.appendFileSync("./loadErrors", '\n' + program.output);

                    chrome.close();
                    fatalKill();
                }, 150000)
            }

            if (program.sim){
                var simConfig = JSON.parse(fs.readFileSync(program.sim, "utf-8"));
                console.log("Loading sim data: " + JSON.stringify(simConfig))
                Network.emulateNetworkConditions(simConfig);
            }

            if (!program.mobile) {
                console.log("emulating mobile on desktop")
                // Network.setUserAgentOverride({userAgent: "Mozilla/5.0 (Linux; Android 8.0.0; Pixel 2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.99 Mobile Safari/537.36"});
                Network.setUserAgentOverride({userAgent: "Mozilla/5.0 (Linux; Android 8.0.0; Pixel 2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.90 Mobile Safari/537.36"}); 
                Emulation.setDeviceMetricsOverride({width:411, height: 731, mobile:true, deviceScaleFactor:0 })
            }

            if (program.jsProfiling) 
                await Profiler.start()
            
            if (program.tracing)
                await Tracing.start({
                    'categories': TRACE_CATEGORIES.join(','),
                    'options': 'sampling-frequency=10000'
                    });

            if (program.network){
                
                Network.responseReceived(function(data){
                    // NetworkLog.push({"Network.requestWillBeSent":data});
                    // console.log(data.response.url);
                    NetworkLog.push(data);
                    // fs.appendFileSync(file, JSON.stringify({"Network.requestWillBeSent":data})+"\n");
                });
            }

            if (program.coverage)
                await Profiler.startPreciseCoverage({'callCount': false, 'detailed': true });

            var count=0;
            var rawEvents = [];

            Tracing.dataCollected(function(data){
                var events = data.value;
                rawEvents = rawEvents.concat(events);
            });
            

            Runtime.exceptionThrown(function(entry){
                consoleLog.push(entry);
            })

            Runtime.consoleAPICalled((entry) =>{
                if (entry.type == "error")
                    consoleLog.push(entry);
                if (entry.type == "log" && entry.args[0].value == "Cache saved.."){
                    console.log("Alert received from web worker, finishing...")
                    dataReceived = true;
                    if (alldataReceived && !program.testing) {
                        collectLogs(program);
                        // if (program.mode == "record")
                        //     customCodes.getStorageOverhead(Runtime, program.output + "/cacheSize");
                        // setTimeout(function(){
                            if (!program.mobile){
                                chrome.close();
                                safeKill();
                            } else {
                                Page.close();
                                chrome.close();
                            }
                            process.exit();
                        // },1000);
                    }

                }
            })

            // HeapProfiler.addHeapSnapshotChunk((chunk)=>{
            //     heapChunks.push(chunk.chunk);
            // })

            Log.entryAdded((entry)=>{
                // consoleLog.push(entry)
            })

            // Debugger.paused(function(d){
            //     console.log(d);
                
            // });

            if (program.url) {
                await Page.navigate({'url':program.url});
                console.log("Page navigated");
            }
            // await Debugger.setBreakpointsActive({active:true});
            await Page.loadEventFired();
            if (program.jsProfiling) {
                var _profilerData = await Profiler.stop(); 
                fs.writeFileSync(program.output + "/jsProfile", JSON.stringify(_profilerData.profile));
                console.log("Profiler data logged")
            }
            // await Page.reload();
            // await Page.loadEventFired();
            clearTimeout(pltTimer);
            console.log("Main load event fired");
            pageLoaded = true;
              // Pause the page is stop any further javascript computation
            // Runtime.evaluate({expression:"debugger;"});
            console.log("Page has been paused");
            
            if (program.correctness){
                var evalString = fs.readFileSync(evalStringFile,"utf-8");
                console.log("Evalling the following expression" + evalString)
                var correctnessCheck = await Runtime.evaluate({expression: evalString, returnByValue:true}).value;
                fs.writeFileSync(program.output + "/correctness", JSON.stringify(correctnessCheck));
            }

            if (!program.testing) {
                pltTimer = setTimeout(function(){
                    console.log("Timer fired before data could be fetched");
                    if (program.log) {
                        fs.writeFileSync(program.output + "/logs", JSON.stringify(consoleLog));
                        console.log("Console data logged");
                    };

                    fs.appendFileSync("./fetchErrors", '\n' + program.output + "\n");

                    chrome.close();
                    fatalKill();

                }, 65000)
            }

            if (program.custom) {
                   await extractCustomInformation(Runtime, program,1);
            } else 
                dataReceived=true
            await extractPageLoadTime(Runtime, "plt");

            if (program.coverage) {
                var _coverageData = await Profiler.takePreciseCoverage();
                var coverageData = _coverageData.result;
                await Profiler.stopPreciseCoverage();

                fs.writeFileSync(program.output + "/coverage" , JSON.stringify(coverageData, null, 2));
                console.log("Coverage data logged");
            }

            if (program.tracing) {
                await Tracing.end();
                await Tracing.tracingComplete();
                fs.writeFileSync(program.output + '/Timeline.trace', JSON.stringify(rawEvents,null,2));
                console.log("Tracing data logged");
            }
    
            if (program.network){
                console.log("Network log length " + NetworkLog.length)
                fs.writeFileSync(program.output +"/network", JSON.stringify(NetworkLog));
            }

            // if (program.jsProfiling) {
                // var _profilerData = await Profiler.stop(); 
                // fs.writeFileSync(program.output + "/jsProfile", JSON.stringify(_profilerData.profile));
                // console.log("Profiler data logged")
            // }

            // var h = await HeapProfiler.takeHeapSnapshot({reportProgess: false});

             if (program.mem){

                // var newTab = await Chrome.New({port:Number(program.port), local: local});
                // var newClient = await Chrome({port:Number(program.port), local: local},newTab);
                // with (newClient){
                //     await Page.enable();
                //     await Page.navigate({url:"chrome://system"});
                //     await Page.loadEventFired();

                //     var _query = await Runtime.evaluate({expression:'document.getElementById("mem_usage-value").innerText;', returnByValue: true})
                //     var memData = _query.result.value;
                //     // var memoryUsageInfo = memData.split('\n')[0]
                //     console.log(memData);


                // }

                // await Chrome.Close({port:Number(program.port), local: local,id:newTab.id});

                // var systemTarget = await Target.createTarget({url:"chrome://system"});
                // var systemTargetId = systemTarget.targetId;
            // var memMsg = "";

                // var response =  Target.sendMessageToTarget({targetId:systemTargetId, 
                //     message: JSON.stringify({id: 2, method: 'Runtime.evaluate', params: {expression: 'document.getElementById("mem_usage-value").innerText;'}}) })
                // // var response =  Target.sendMessageToTarget({targetId:systemTargetId, 
                // //     message: JSON.stringify({id: 2, method: 'Runtime.evaluate', params: {expression: 'alert(2);'}}) })
                // console.log(response);
                //  var resp = await Target.receivedMessageFromTarget({targetId:systemTargetId})

                // // data = await resp;
                // console.log(resp);
                // console.log("memory message received is " + memMsg);
                await customCodes.getInvocationProperties(Runtime, program.output + "/mem", 'performance.memory.usedJSHeapSize');

                // fs.writeFileSync(program.output +"/mem", JSON.stringify(memData));
            }
            //mark all data received
            alldataReceived = true;
            if (program.mode != "record" || dataReceived)
                clearTimeout(pltTimer);
            // a=spawnSync("ps aux | grep replayshell | awk '{print $2}' | xargs kill -9",{shell:true});
            // Don't immediately kill Chrome as it takes some time for the cache to be dumped on disk
            if (!program.testing && (program.mode != "record" || dataReceived) ) {
                collectLogs(program);
                // if (program.mode == "record")
                //     await customCodes.getStorageOverhead(Runtime, program.output + "/cacheSize");
                setTimeout(function(){
                    if (!program.mobile){
                        chrome.close();
                        safeKill();
                    } else {
                        Page.close();
                        chrome.close();
                    }
                    process.exit();
                },1000);
            }
        }

        } catch (e){
            console.error(e);
            launcher.kill();
        }
    }).on('error', function(er){
        console.log("can't connect to chrome", er);
    });
}

function collectLogs(program){
    if (program.log) {
        fs.writeFileSync(program.output + "/logs", JSON.stringify(consoleLog));
        console.log("Console data logged");
    }
}

async function pausePage(Runtime){
    await Runtime.evaluate({expression: 'debugger'});
    console.log("Page paused to process data");
}

// async function getJSCoverage()

async function NetworkEventHandlers(Network, file){
    await mkdirp(file.split('/').slice(0,-1).join('/'));
    // Network.requestWillBeSent(function(data){
    //     NetworkLog.push(data);
    // });
    Network.requestWillBeSent(function(data){
        NetworkLog.push({"Network.requestWillBeSent":data});
        // fs.appendFileSync(file, JSON.stringify({"Network.requestWillBeSent":data})+"\n");
    });

    console.log("Network trace file: " + file);
    // Network.requestServedFromCache(function(data){
    //     // fs.appendFileSync(file, JSON.stringify({"Network.requestServedFromCache":data})+"\n");
    // });

    // Network.responseReceived(function(data){
    //     NetworkLog.push({"Network.responseReceived":data});
    //     // fs.appendFileSync(file, JSON.stringify({"Network.responseReceived":data})+"\n");
    // });

    // Network.dataReceived(function(data){
    //     fs.appendFileSync(file, JSON.stringify({"Network.dataReceived":data})+"\n");
    // });

    // Network.loadingFinished(function(data){
    //     fs.appendFileSync(file, JSON.stringify({"Network.loadingFinished":data})+"\n");
    // });

}

async function extractCustomInformation(Runtime, program, path){
    if (program.mode == "record") {
       await customCodes.getInvocationProperties(Runtime, program.output  + "/cacheStats", '__tracer.getCacheStats()');
       var runPostLoadScripts = await customCodes.runPostLoadScripts(Runtime);
       if (runPostLoadScripts == 0){

         // await customCodes.getCacheSize(Runtime, program.output);

        } else {
            fs.appendFileSync("./fetchErrors"  , '\n' + program.url + "\n" + runPostLoadScripts);
            consoleLog.push(runPostLoadScripts);
        }
        // await customCodes.getInvocationProperties(Runtime, program.output + "/dc" + path, '__tracer.getDC()',0);
       // await customCodes.getInvocationProperties(Runtime, program.output + "/timingInfo" + path, '__tracer.getTimingInfo()',);
       // await customCodes.getInvocationProperties(Runtime, program.output + "/reads", 'node2reads');
       await customCodes.getInvocationProperties(Runtime, program.output + "/mem", 'performance.memory.usedJSHeapSize');
       // await customCodes.getInvocationProperties(Runtime, program.output + "/callGraph", '__tracer.getCallGraph()');
       // await customCodes.getInvocationProperties(Runtime, program.output + "/invocations", '__tracer.getInvocations()');
       await customCodes.getInvocationProperties(Runtime, program.output + "/noncacheable", '__tracer.getNonCacheableFunctions()');
       await customCodes.getDOM(Runtime, program.output +"/DOM");
       // await customCodes.getInvocationProperties(Runtime, program.output + "/signature", '__tracer.getProcessedSignature()');
       dataReceived = true
       // await customCodes.getProcessedSignature(Runtime, program.output);
   } else if (program.mode == "replay"){
        // await customCodes.getInvocationProperties(Runtime, program.output  + "/invocProps", 'Object.keys(__tracer.getCustomCache())');
        await customCodes.getInvocationProperties(Runtime, program.output  + "/cacheStats", '__tracer.getCacheStats()');
        await customCodes.getInvocationProperties(Runtime, program.output  + "/cacheExists", 'localStorage.getItem("fnCacheExists")');
        await customCodes.getInvocationProperties(Runtime, program.output + "/callGraph", '__tracer.getCallGraph()');
        await customCodes.getInvocationProperties(Runtime, program.output + "/timingInfo" + path, '__tracer.getTimingInfo()');
        await customCodes.getInvocationProperties(Runtime, program.output + "/invocations", '__tracer.getInvocations()');
        await customCodes.getInvocationProperties(Runtime, program.output + "/setupStateTime", 'window.top.setupStateTime');
        await customCodes.getDOM(Runtime, program.output +"/DOM");
   } else {
        // await customCodes.getInvocationProperties(Runtime, program.output + "/leafNodes" + path, 'leafNodes',1);
        // await customCodes.getInvocationProperties(Runtime, program.output + "/timingInfo", '__tracer.getTimingInfo()');
        // await customCodes.getInvocationProperties(Runtime, program.output + "/cg", '__tracer.getCallGraph()');
        await customCodes.getInvocationProperties(Runtime, program.output + "/rc", 'window.proxyReadCount');
        await customCodes.getInvocationProperties(Runtime, program.output + "/wc", 'window.proxyWriteCount');
        // await customCodes.getInvocationProperties(Runtime, program.output + "/parentNodes", '__tracer.getParentNodes()');
        // await customCodes.getInvocationProperties(Runtime, program.output + "/nonLeafNodes", '__tracer.getNonLeafNodes()');
        // await customCodes.getInvocationProperties(Runtime, program.output + "/minHeap", 'minHeap');
   }
   // await customCodes.getInvocationProperties(Runtime, program.output  + "/callgraph", 'Object.keys(__tracer.getCallGraph())');
   console.log("Custom data logged");
}


async function extractPageLoadTime(Runtime, outputFile){
    var _query  = await Runtime.evaluate({expression: 'performance.timing.navigationStart'})
    pageLoadTime["startTime"] = _query.result.value
    var _query  = await Runtime.evaluate({expression: 'performance.timing.loadEventEnd'})
    pageLoadTime["end"] = _query.result.value
    var _query  = await Runtime.evaluate({expression: 'performance.timing.loadEventStart'})
    pageLoadTime["loadStartTime"] = _query.result.value

    pageLoadTime["loadTime"] = pageLoadTime["end"] - pageLoadTime["startTime"];
    pageLoadTime["actualLoadTime"] = pageLoadTime["loadStartTime"] - pageLoadTime["startTime"];

    console.log("Dump performance timing information to file " + JSON.stringify(pageLoadTime));
    fs.writeFileSync(program.output + outputFile, JSON.stringify(pageLoadTime));

}

function escapeBackSlash(str){
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\^\$\|\'\_]/g, "\\$&");
}


if (program.launch) {
    if (program.mode == "record"){
        console.log("Mode:Record")
        var chromeUserDirExt = (new Date).getTime();
        fs.writeFileSync(chromeUserDir, chromeUserDirExt);
    } else if (program.mode == "replay"){
        console.log("Mode:Replay")
        try {
            var chromeUserDirExt = fs.readFileSync(chromeUserDir);
        } catch (e){
            console.error("Running in replay mode, however no cache directory from previous run");
            process.exit();
        }
    } else {
        console.log("Running code without caching framework in place");
        var chromeUserDirExt = (new Date).getTime();
        fs.writeFileSync(chromeUserDir, chromeUserDirExt);
        // process.exit();
    }
    chromeLauncher.launch({
     port:Number(program.port),
     chromeFlags: [
        '--ignore-certificate-errors',
        '--disable-web-security',
        '--disable-extensions ',
        // '--js-flags="--expose-gc"',
        '--auto-open-devtools-for-tabs',
        // '--enable-devtools-experiments',
        '--disable-features=IsolateOrigins,site-per-process,CrossSiteDocumentBlockingAlways,CrossSiteDocumentBlockingIfIsolating',
        '--disable-site-isolation-trials',
        '--allow-running-insecure-content',
         // '--headless',
         // '--v8-cache-options=off',
         // '--js-flags="--compilation-cache false"',
         // '--user-data-dir=/tmp/chromeProfiles/' + program.url.split('//')[1]
         '--user-data-dir=/tmp/nontstent' + chromeUserDirExt,
    ]
}).then(chrome => {
    console.log("chrome is launched, navigating page");
    navigate(chrome);
});
} else {
    // spawnSync("chromium-browser --remote-debugging-port=9222 --ignore-certificate-errors --user-data-dir=/tmp/nonexistent$(date +%s%N) ; sleep 6");
    console.log("chrome launched");
    navigate(); 
}

/*
Running chrome from android: run with the following runtime flags
chrome --ignore-certificate-errors --allow-running-insecure-content --no-first-run --disable-fre --no-default-browser-check --remote-debugging-port=9222 --disable-web-security --disable-features=IsolateOrigins,site-per-process,CrossSiteDocumentBlockingAlways,CrossSiteDocumentBlockingIfIsolating --disable-site-isolation-trials --no-sandbox --allow-file-access-from-files --allow-file-access --user-data-dir=/data/user/0/com.android.chrome/app_chrome/1557610171087306327
*/

