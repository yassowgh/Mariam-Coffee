import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The RAR reader (node-unrar-js, Emscripten) names functions with new Function(), which the site's
// Content-Security-Policy forbids. Same result without evaluating a string:
const noEvalUnrar = {
  name: 'no-eval-unrar',
  transform(code, id) {
    if (!/node-unrar-js[\\/].*unrar\.js$/.test(id) || !code.includes('new Function("body"')) return null;
    const out = code.replace(
      /function createNamedFunction\(name,body\)\{name=makeLegalFunctionName\(name\);return new Function\([^]*?\)\(body\)\}/,
      'function createNamedFunction(name,body){name=makeLegalFunctionName(name);var f=function(){"use strict";return body.apply(this,arguments)};try{Object.defineProperty(f,"name",{value:name})}catch(e){}return f}',
    );
    if (out === code) this.error('no-eval-unrar: the code to replace was not found (node-unrar-js changed?)');
    // embind builds each C++ call wrapper as source text + new Function(); this closure does the same steps
    const TAIL = 'args1.push(invokerFnBody);var invokerFunction=new_(Function,args1).apply(null,args2);return invokerFunction}';
    if (!out.includes(TAIL)) this.error('no-eval-unrar: craftInvokerFunction not found (node-unrar-js changed?)');
    const out2 = out.replace(TAIL, `var nArgs=argCount-2,retType=argTypes[0],classParam=argTypes[1];
var invokerFunction=function(){
  if(arguments.length!==nArgs){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+nArgs+" args!")}
  var destructors=needsDestructorStack?[]:null;var wired=[];
  if(isClassMethodFunc){wired.push(classParam.toWireType(destructors,this))}
  for(var a=0;a<nArgs;++a){wired.push(argTypes[a+2].toWireType(destructors,arguments[a]))}
  var rv=cppInvokerFunc.apply(null,[cppTargetFunc].concat(wired));
  if(needsDestructorStack){runDestructors(destructors)}else{
    for(var d=isClassMethodFunc?1:2;d<argTypes.length;++d){
      if(argTypes[d].destructorFunction!==null){argTypes[d].destructorFunction(d===1?wired[0]:wired[(isClassMethodFunc?1:0)+(d-2)])}
    }
  }
  if(returns){return retType.fromWireType(rv)}
};
try{Object.defineProperty(invokerFunction,"name",{value:makeLegalFunctionName(humanName)})}catch(e){}
return invokerFunction}`);
    return { code: out2, map: null };
  },
};

// `npm run build` -> dist/ for Cloudflare Pages.
// `npm run build:single` -> one self-contained HTML file (dist-single/index.html).
export default defineConfig(({ mode }) => ({
  // The management app lives under mariamcoffeeshop.com/management/
  base: mode === 'single' ? './' : '/management/',
  plugins: mode === 'single' ? [react(), noEvalUnrar, viteSingleFile()] : [react(), noEvalUnrar],
  // Older iPhones/iPads (Safari 14+) must still run the app, so the code is translated down.
  build: {
    target: ['es2020', 'safari14', 'chrome87', 'firefox78', 'edge88'],
    cssTarget: ['safari14', 'chrome87'],
    ...(mode === 'single' ? { outDir: 'dist-single', assetsInlineLimit: 100000000 } : { outDir: 'dist/management', emptyOutDir: true }),
  },
}));
