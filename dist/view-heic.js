"use strict";(()=>{var fe=Object.defineProperty;var ne=(t,e,r)=>e in t?fe(t,e,{enumerable:!0,configurable:!0,writable:!0,value:r}):t[e]=r;var x=(t,e,r)=>(ne(t,typeof e!="symbol"?e+"":e,r),r);var ie=typeof global=="object"&&global&&global.Object===Object&&global,_=ie;var le=typeof self=="object"&&self&&self.Object===Object&&self,ue=_||le||Function("return this")(),T=ue;var de=T.Symbol,E=de;var N=Object.prototype,pe=N.hasOwnProperty,me=N.toString,w=E?E.toStringTag:void 0;function ce(t){var e=pe.call(t,w),r=t[w];try{t[w]=void 0;var a=!0}catch{}var o=me.call(t);return a&&(e?t[w]=r:delete t[w]),o}var j=ce;var xe=Object.prototype,he=xe.toString;function ge(t){return he.call(t)}var U=ge;var ye="[object Null]",Ee="[object Undefined]",B=E?E.toStringTag:void 0;function be(t){return t==null?t===void 0?Ee:ye:B&&B in Object(t)?j(t):U(t)}var D=be;function Ce(t){return t!=null&&typeof t=="object"}var F=Ce;var Ie="[object Symbol]";function we(t){return typeof t=="symbol"||F(t)&&D(t)==Ie}var V=we;var ve=/\s/;function Re(t){for(var e=t.length;e--&&ve.test(t.charAt(e)););return e}var G=Re;var Oe=/^\s+/;function Te(t){return t&&t.slice(0,G(t)+1).replace(Oe,"")}var z=Te;function Se(t){var e=typeof t;return t!=null&&(e=="object"||e=="function")}var v=Se;var K=0/0,Ae=/^[-+]0x[0-9a-f]+$/i,Le=/^0b[01]+$/i,ke=/^0o[0-7]+$/i,Me=parseInt;function He(t){if(typeof t=="number")return t;if(V(t))return K;if(v(t)){var e=typeof t.valueOf=="function"?t.valueOf():t;t=v(e)?e+"":e}if(typeof t!="string")return t===0?t:+t;t=z(t);var r=Le.test(t);return r||ke.test(t)?Me(t.slice(2),r?2:8):Ae.test(t)?K:+t}var k=He;var We=function(){return T.Date.now()},S=We;var Pe="Expected a function",_e=Math.max,Ne=Math.min;function je(t,e,r){var a,o,n,s,f,l,u=0,p=!1,d=!1,g=!0;if(typeof t!="function")throw new TypeError(Pe);e=k(e)||0,v(r)&&(p=!!r.leading,d="maxWait"in r,n=d?_e(k(r.maxWait)||0,e):n,g="trailing"in r?!!r.trailing:g);function m(i){var c=a,I=o;return a=o=void 0,u=i,s=t.apply(I,c),s}function re(i){return u=i,f=setTimeout(O,e),p?m(i):s}function oe(i){var c=i-l,I=i-u,P=e-c;return d?Ne(P,n-I):P}function H(i){var c=i-l,I=i-u;return l===void 0||c>=e||c<0||d&&I>=n}function O(){var i=S();if(H(i))return W(i);f=setTimeout(O,oe(i))}function W(i){return f=void 0,g&&a?m(i):(a=o=void 0,s)}function ae(){f!==void 0&&clearTimeout(f),u=0,a=l=o=f=void 0}function se(){return f===void 0?s:W(S())}function L(){var i=S(),c=H(i);if(a=arguments,o=this,l=i,c){if(f===void 0)return re(l);if(d)return clearTimeout(f),f=setTimeout(O,e),m(l)}return f===void 0&&(f=setTimeout(O,e)),s}return L.cancel=ae,L.flush=se,L}var M=je;var y={MAX_FILE_SIZE:52428800,MAX_CONCURRENT:3,DEBOUNCE_DELAY:300,CONVERSION_QUALITY:.9,RETRY_ATTEMPTS:2,ANIMATION_FPS:24,MAX_CACHE_ITEMS:10},q={HEIC_IMAGES:'img[src*=".HEIC"], img[src*=".heic"], img[src*=".HEIF"], img[src*=".heif"]',PROCESSING_CLASS:"heic-processing",ERROR_CLASS:"heic-error"},h={ORIGINAL_SRC:"data-original-src",PROCESSED:"data-heic-processed",ERROR_COUNT:"data-error-count"},R={FILE_TOO_LARGE:"\u56FE\u7247\u6587\u4EF6\u8FC7\u5927\uFF0C\u8D85\u8FC750MB\u9650\u5236",INVALID_FORMAT:"\u4E0D\u662F\u6709\u6548\u7684HEIC\u683C\u5F0F\u6587\u4EF6",NETWORK_ERROR:"\u7F51\u7EDC\u9519\u8BEF\uFF0C\u65E0\u6CD5\u83B7\u53D6\u56FE\u7247",CONVERSION_FAILED:"HEIC\u8F6C\u6362\u5931\u8D25",CORS_ERROR:"\u8DE8\u57DF\u8BBF\u95EE\u88AB\u62D2\u7EDD"},b={FILE_TOO_LARGE:"size",INVALID_FORMAT:"format",NETWORK_ERROR:"network",CONVERSION_FAILED:"conversion",CORS_ERROR:"cors"};var C=null;async function $(){if(C!==null)return C;if(typeof VideoDecoder>"u")return C=!1;try{let t={codec:"hvc1.1.6.L120.90"};return(await VideoDecoder.isConfigSupported({...t,hardwareAcceleration:"prefer-hardware"})).supported?C=!0:C=(await VideoDecoder.isConfigSupported(t)).supported??!1}catch{return C=!1}}var Q="./heic-worker-hard.js";var Y="./heic-worker-soft.js";var Ue=new Set(["mif1","heic","heix"]),X=new Set(["msf1","hevc","hevx"]);function Z(t){if(t.byteLength<12)return"";let e=new Uint8Array(t,8,4);return String.fromCharCode(...e).replace(/\0/g," ").trim()}function Be(t){let e=Z(t);return Ue.has(e)||X.has(e)}function De(t){return X.has(Z(t))}var A=class{constructor(){x(this,"processedImages",new WeakSet);x(this,"processingQueue",new Map);x(this,"urlCache",new Map);x(this,"animationTimers",new Map);x(this,"workerPromise");x(this,"workerTaskId",0);x(this,"workerCallbacks",new Map);this.workerPromise=this.initWorker()}async initWorker(){try{let r=await $()?Q:Y,a;if(typeof chrome<"u"&&chrome.runtime?.getURL){let o=chrome.runtime.getURL(r),s=await(await fetch(o)).blob(),f=URL.createObjectURL(s);a=new Worker(f,{type:"module"}),URL.revokeObjectURL(f)}else a=new Worker(r,{type:"module"});return a.onmessage=o=>{let{id:n,success:s,error:f,type:l,url:u,frames:p,width:d,height:g}=o.data,m=this.workerCallbacks.get(n);m&&(s?m.resolve({type:l,url:u,frames:p,width:d,height:g}):m.reject(new Error(f)),this.workerCallbacks.delete(n))},a.onerror=o=>{console.error("\u{1F534} HEIC Worker \u53D1\u751F\u5F02\u5E38:",o.message||o);let n=o.message||"Worker \u52A0\u8F7D\u5931\u8D25\u6216\u53D1\u751F\u81F4\u547D\u9519\u8BEF";this.workerCallbacks.forEach((s,f)=>{s.reject(new Error(n))}),this.workerCallbacks.clear(),this.workerPromise=Promise.reject(new Error("Worker crashed"))},a.addEventListener("unhandledrejection",o=>{console.warn("\u{1F7E0} HEIC Worker \u672A\u6355\u83B7\u7684 Promise \u62D2\u7EDD:",o.reason)}),a}catch(e){throw console.error("\u{1F534} HEIC Worker \u540C\u6B65\u521D\u59CB\u5316\u5931\u8D25:",e),new Error(`Worker \u521D\u59CB\u5316\u5931\u8D25: ${e.message||"\u672A\u77E5\u9519\u8BEF"}`)}}getCacheKey(e){let r=e.match(/^.*?\.(?:heic|heif)/i);return r?r[0]:e}getCacheEntry(e){if(!this.urlCache.has(e))return;let r=this.urlCache.get(e);return this.urlCache.delete(e),this.urlCache.set(e,r),r}setCacheEntry(e,r){if(this.urlCache.has(e))this.urlCache.delete(e);else for(;this.urlCache.size>=y.MAX_CACHE_ITEMS;){let a=this.urlCache.keys().next().value;if(!a)break;let o=this.urlCache.get(a);o&&o.refCount<=0&&(o.type==="single"?URL.revokeObjectURL(o.url):o.frames.forEach(n=>URL.revokeObjectURL(n.url))),this.urlCache.delete(a)}this.urlCache.set(e,r)}isImageProcessed(e){return this.processedImages.has(e)||e.hasAttribute(h.PROCESSED)}markImageAsProcessed(e){this.processedImages.add(e),e.setAttribute(h.PROCESSED,"true")}resetImageProcessed(e){this.processedImages.delete(e),this.animationTimers.has(e)&&(cancelAnimationFrame(this.animationTimers.get(e)),this.animationTimers.delete(e));let r=e.getAttribute(h.ORIGINAL_SRC);if(r){let a=this.getCacheKey(r),o=this.urlCache.get(a);o&&(o.refCount=Math.max(0,o.refCount-1))}e.removeAttribute(h.PROCESSED),e.removeAttribute(h.ORIGINAL_SRC),e.classList.remove("heic-processing","heic-converted")}async fetchImageDataWithRetry(e,r){let a;for(let o=0;o<r;o++)try{let n=await fetch(e);if(!n.ok)throw new Error(`HTTP ${n.status}: ${n.statusText}`,{type:b.NETWORK_ERROR});let s=await n.blob();if(s.size>y.MAX_FILE_SIZE)throw new Error(R.FILE_TOO_LARGE,{type:b.FILE_TOO_LARGE});let f=await s.arrayBuffer(),l=["image/heic","image/heif","image/heic-sequence","image/heif-sequence"].includes(s.type);if(!Be(f)&&!l)throw new Error(R.INVALID_FORMAT,{type:b.INVALID_FORMAT});return f}catch(n){if(a=n,n.name==="TypeError"){let s=!1;try{s=new URL(e).origin!==location.origin}catch{}if(s)throw new Error(R.CORS_ERROR,{type:b.CORS_ERROR})}o<r-1&&await new Promise(s=>setTimeout(s,1e3*(o+1)))}throw a||new Error(R.NETWORK_ERROR,{type:b.NETWORK_ERROR})}setupUrlAnimation(e,r){let a=0,o=performance.now(),n=Math.max(16,r.reduce((f,l)=>f+l.durationMs,0)/r.length);e.src=r[a].url;let s=f=>{f-o>=n&&(a=(a+1)%r.length,e.src=r[a].url,o=f),this.animationTimers.set(e,requestAnimationFrame(s))};this.animationTimers.set(e,requestAnimationFrame(s)),this.markImageAsProcessed(e)}async convertImage(e,r={}){if(this.isImageProcessed(e))return{success:!0};if(this.processingQueue.has(e))return this.processingQueue.get(e);let a=this._doConvert(e,r);this.processingQueue.set(e,a);try{return await a}finally{this.processingQueue.delete(e)}}async _doConvert(e,r={}){let a=e.src,o=this.getCacheKey(a),{maxRetries:n=y.RETRY_ATTEMPTS}=r;e.hasAttribute(h.ORIGINAL_SRC)||e.setAttribute(h.ORIGINAL_SRC,a);let s=this.getCacheEntry(o);if(s)return s.refCount++,s.type==="single"?(e.src=s.url,e.classList.add("heic-converted"),this.markImageAsProcessed(e)):s.type==="animated"&&(this.setupUrlAnimation(e,s.frames),e.classList.add("heic-converted")),{success:!0};e.classList.add("heic-processing");try{let f=await this.fetchImageDataWithRetry(a,n),l=De(f)?"animated":"single",u=await this.workerPromise,p=this.workerTaskId++,d=await new Promise((g,m)=>{this.workerCallbacks.set(p,{resolve:g,reject:m}),u.postMessage({id:p,buffer:f,options:r,type:l},[f])});return d.type==="animated"?(this.setCacheEntry(o,{type:"animated",frames:d.frames,refCount:1}),this.setupUrlAnimation(e,d.frames)):(this.setCacheEntry(o,{type:"single",url:d.url,refCount:1}),e.src=d.url,this.markImageAsProcessed(e)),e.classList.remove("heic-processing"),e.classList.add("heic-converted"),{success:!0}}catch(f){return this.handleConversionError(e,f,a)}}async convertAllImages(e,r={}){let a=[],o=Array.from(e),n=0,s=new Set,f=async()=>{if(n===o.length)return;let l=o[n++],u=this.convertImage(l,r).then(p=>{a.push(p),s.delete(u)}).catch(p=>{a.push({success:!1,error:{type:error?.type||"unknown",message:error?.message||"Error"}}),s.delete(u)});s.add(u),s.size>=y.MAX_CONCURRENT&&await Promise.race(s),await f()};return await f(),await Promise.all(s),a}cleanup(){this.urlCache.forEach(e=>{e.type==="single"?URL.revokeObjectURL(e.url):e.frames.forEach(r=>URL.revokeObjectURL(r.url))}),this.urlCache.clear(),this.processingQueue.clear(),this.animationTimers.forEach(e=>cancelAnimationFrame(e)),this.animationTimers.clear(),this.workerPromise.then(e=>e.terminate())}handleConversionError(e,r,a){return e.classList.remove("heic-processing"),e.classList.add("heic-converted"),{success:!1,error:{type:r?.type||"unknown",message:r?.message||"Error"}}}};function J(){console.log("\u{1F5BC}\uFE0F View HEIC Loaded"),Fe();let t=new A;ee(t);let e=Ve(t),r=()=>{e.disconnect(),t.cleanup()};return window.addEventListener("beforeunload",r,{once:!0}),{converter:t,stop:r}}function Fe(){let t="view-heic-styles";if(document.getElementById(t))return;let e=document.createElement("style");e.id=t,e.textContent=`
    /* HEIC\u56FE\u7247\u5904\u7406\u72B6\u6001\u6837\u5F0F */
    .heic-processing {
      position: relative;
      opacity: 0.7;
      transition: opacity 0.3s ease;
    }

    .heic-processing::after {
      content: "\u{1F504} \u8F6C\u6362\u4E2D...";
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      z-index: 1000;
      pointer-events: none;
    }

    .heic-converted {
      opacity: 1;
      transition: opacity 0.3s ease;
    }

    .heic-error {
      position: relative;
      border: 2px dashed #ff6b6b !important;
      opacity: 0.8;
      filter: grayscale(50%);
      cursor: pointer;
    }

    .heic-error::after {
      content: "\u274C \u8F6C\u6362\u5931\u8D25 - \u70B9\u51FB\u67E5\u770B\u539F\u56FE";
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 107, 107, 0.9);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      z-index: 1000;
      pointer-events: none;
    }

    .heic-error:hover {
      opacity: 1;
      filter: grayscale(0%);
    }
  `,document.head.appendChild(e)}async function ee(t){let e=document.querySelectorAll(q.HEIC_IMAGES);if(e.length===0)return;console.log(`\u{1F4F7} \u53D1\u73B0 ${e.length} \u5F20HEIC\u56FE\u7247\uFF0C\u5F00\u59CB\u8F6C\u6362...`);let r=await t.convertAllImages(e),a=r.filter(n=>n.success).length,o=r.length-a;console.log(`\u2705 \u8F6C\u6362\u5B8C\u6210: ${a} \u6210\u529F, ${o} \u5931\u8D25`),o>0&&console.warn("\u26A0\uFE0F \u90E8\u5206\u56FE\u7247\u8F6C\u6362\u5931\u8D25\uFF0C\u53EF\u80FD\u662F\u7531\u4E8ECORS\u9650\u5236\u6216\u683C\u5F0F\u95EE\u9898")}function Ve(t){let e=M(()=>{ee(t)},y.DEBOUNCE_DELAY,{trailing:!0,leading:!1}),r=new MutationObserver(a=>{let o=!1;for(let n of a){if(n.type==="attributes"&&n.attributeName==="src"){let s=n.target;if(s.nodeType===Node.ELEMENT_NODE&&s.tagName==="IMG"){let f=s;f.src.startsWith("blob:")||(t.resetImageProcessed(f),Ge(f)&&(o=!0))}}if(o)break}o&&e()});return r.observe(document.body,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["src"]}),r}function Ge(t){let e=t.src.toLowerCase(),r=t.alt.toLowerCase();return e.endsWith(".heic")||e.endsWith(".heif")||r.endsWith(".heic")||r.endsWith(".heif")}function te(){let t=J();return window.ViewHEIC=t,t}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>void te(),{once:!0}):te();})();
/*! Bundled license information:

lodash-es/lodash.js:
  (**
   * @license
   * Lodash (Custom Build) <https://lodash.com/>
   * Build: `lodash modularize exports="es" --repo lodash/lodash#4.18.1 -o ./`
   * Copyright OpenJS Foundation and other contributors <https://openjsf.org/>
   * Released under MIT license <https://lodash.com/license>
   * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
   * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
   *)
*/
