import{useEffect as Ke,useRef as re,useState as Jo}from"react";function _e(e){var r,t,o="";if(typeof e=="string"||typeof e=="number")o+=e;else if(typeof e=="object")if(Array.isArray(e)){var i=e.length;for(r=0;r<i;r++)e[r]&&(t=_e(e[r]))&&(o&&(o+=" "),o+=t)}else for(t in e)e[t]&&(o&&(o+=" "),o+=t);return o}function Pe(){for(var e,r,t=0,o="",i=arguments.length;t<i;t++)(e=arguments[t])&&(r=_e(e))&&(o&&(o+=" "),o+=r);return o}var ao=(e,r)=>{let t=new Array(e.length+r.length);for(let o=0;o<e.length;o++)t[o]=e[o];for(let o=0;o<r.length;o++)t[e.length+o]=r[o];return t},lo=(e,r)=>({classGroupId:e,validator:r}),Me=(e=new Map,r=null,t)=>({nextPart:e,validators:r,classGroupId:t}),pe="-",Ae=[],co="arbitrary..",mo=e=>{let r=uo(e),{conflictingClassGroups:t,conflictingClassGroupModifiers:o}=e;return{getClassGroupId:d=>{if(d.startsWith("[")&&d.endsWith("]"))return fo(d);let p=d.split(pe),b=p[0]===""&&p.length>1?1:0;return Oe(p,b,r)},getConflictingClassGroupIds:(d,p)=>{if(p){let b=o[d],m=t[d];return b?m?ao(m,b):b:m||Ae}return t[d]||Ae}}},Oe=(e,r,t)=>{if(e.length-r===0)return t.classGroupId;let i=e[r],c=t.nextPart.get(i);if(c){let m=Oe(e,r+1,c);if(m)return m}let d=t.validators;if(d===null)return;let p=r===0?e.join(pe):e.slice(r).join(pe),b=d.length;for(let m=0;m<b;m++){let k=d[m];if(k.validator(p))return k.classGroupId}},fo=e=>e.slice(1,-1).indexOf(":")===-1?void 0:(()=>{let r=e.slice(1,-1),t=r.indexOf(":"),o=r.slice(0,t);return o?co+o:void 0})(),uo=e=>{let{theme:r,classGroups:t}=e;return po(t,r)},po=(e,r)=>{let t=Me();for(let o in e){let i=e[o];xe(i,t,o,r)}return t},xe=(e,r,t,o)=>{let i=e.length;for(let c=0;c<i;c++){let d=e[c];bo(d,r,t,o)}},bo=(e,r,t,o)=>{if(typeof e=="string"){go(e,r,t);return}if(typeof e=="function"){ho(e,r,t,o);return}vo(e,r,t,o)},go=(e,r,t)=>{let o=e===""?r:We(r,e);o.classGroupId=t},ho=(e,r,t,o)=>{if(xo(e)){xe(e(o),r,t,o);return}r.validators===null&&(r.validators=[]),r.validators.push(lo(t,e))},vo=(e,r,t,o)=>{let i=Object.entries(e),c=i.length;for(let d=0;d<c;d++){let[p,b]=i[d];xe(b,We(r,p),t,o)}},We=(e,r)=>{let t=e,o=r.split(pe),i=o.length;for(let c=0;c<i;c++){let d=o[c],p=t.nextPart.get(d);p||(p=Me(),t.nextPart.set(d,p)),t=p}return t},xo=e=>"isThemeGetter"in e&&e.isThemeGetter===!0,wo=e=>{if(e<1)return{get:()=>{},set:()=>{}};let r=0,t=Object.create(null),o=Object.create(null),i=(c,d)=>{t[c]=d,r++,r>e&&(r=0,o=t,t=Object.create(null))};return{get(c){let d=t[c];if(d!==void 0)return d;if((d=o[c])!==void 0)return i(c,d),d},set(c,d){c in t?t[c]=d:i(c,d)}}},ve="!",Re=":",yo=[],Ee=(e,r,t,o,i)=>({modifiers:e,hasImportantModifier:r,baseClassName:t,maybePostfixModifierPosition:o,isExternal:i}),ko=e=>{let{prefix:r,experimentalParseClassName:t}=e,o=i=>{let c=[],d=0,p=0,b=0,m,k=i.length;for(let L=0;L<k;L++){let C=i[L];if(d===0&&p===0){if(C===Re){c.push(i.slice(b,L)),b=L+1;continue}if(C==="/"){m=L;continue}}C==="["?d++:C==="]"?d--:C==="("?p++:C===")"&&p--}let x=c.length===0?i:i.slice(b),M=x,P=!1;x.endsWith(ve)?(M=x.slice(0,-1),P=!0):x.startsWith(ve)&&(M=x.slice(1),P=!0);let U=m&&m>b?m-b:void 0;return Ee(c,P,M,U)};if(r){let i=r+Re,c=o;o=d=>d.startsWith(i)?c(d.slice(i.length)):Ee(yo,!1,d,void 0,!0)}if(t){let i=o;o=c=>t({className:c,parseClassName:i})}return o},Lo=e=>{let r=new Map;return e.orderSensitiveModifiers.forEach((t,o)=>{r.set(t,1e6+o)}),t=>{let o=[],i=[];for(let c=0;c<t.length;c++){let d=t[c],p=d[0]==="[",b=r.has(d);p||b?(i.length>0&&(i.sort(),o.push(...i),i=[]),o.push(d)):i.push(d)}return i.length>0&&(i.sort(),o.push(...i)),o}},zo=e=>({cache:wo(e.cacheSize),parseClassName:ko(e),sortModifiers:Lo(e),postfixLookupClassGroupIds:So(e),...mo(e)}),So=e=>{let r=Object.create(null),t=e.postfixLookupClassGroups;if(t)for(let o=0;o<t.length;o++)r[t[o]]=!0;return r},Co=/\s+/,_o=(e,r)=>{let{parseClassName:t,getClassGroupId:o,getConflictingClassGroupIds:i,sortModifiers:c,postfixLookupClassGroupIds:d}=r,p=[],b=e.trim().split(Co),m="";for(let k=b.length-1;k>=0;k-=1){let x=b[k],{isExternal:M,modifiers:P,hasImportantModifier:U,baseClassName:L,maybePostfixModifierPosition:C}=t(x);if(M){m=x+(m.length>0?" "+m:m);continue}let N=!!C,_;if(N){let G=L.substring(0,C);_=o(G);let n=_&&d[_]?o(L):void 0;n&&n!==_&&(_=n,N=!1)}else _=o(L);if(!_){if(!N){m=x+(m.length>0?" "+m:m);continue}if(_=o(L),!_){m=x+(m.length>0?" "+m:m);continue}N=!1}let $=P.length===0?"":P.length===1?P[0]:c(P).join(":"),V=U?$+ve:$,H=V+_;if(p.indexOf(H)>-1)continue;p.push(H);let Y=i(_,N);for(let G=0;G<Y.length;++G){let n=Y[G];p.push(V+n)}m=x+(m.length>0?" "+m:m)}return m},Po=(...e)=>{let r=0,t,o,i="";for(;r<e.length;)(t=e[r++])&&(o=Fe(t))&&(i&&(i+=" "),i+=o);return i},Fe=e=>{if(typeof e=="string")return e;let r,t="";for(let o=0;o<e.length;o++)e[o]&&(r=Fe(e[o]))&&(t&&(t+=" "),t+=r);return t},Ao=(e,...r)=>{let t,o,i,c,d=b=>{let m=r.reduce((k,x)=>x(k),e());return t=zo(m),o=t.cache.get,i=t.cache.set,c=p,p(b)},p=b=>{let m=o(b);if(m)return m;let k=_o(b,t);return i(b,k),k};return c=d,(...b)=>c(Po(...b))},Ro=[],y=e=>{let r=t=>t[e]||Ro;return r.isThemeGetter=!0,r},Ne=/^\[(?:(\w[\w-]*):)?(.+)\]$/i,De=/^\((?:(\w[\w-]*):)?(.+)\)$/i,Eo=/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/,Go=/^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/,To=/\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/,Io=/^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/,Mo=/^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/,Oo=/^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/,j=e=>Eo.test(e),u=e=>!!e&&!Number.isNaN(Number(e)),F=e=>!!e&&Number.isInteger(Number(e)),he=e=>e.endsWith("%")&&u(e.slice(0,-1)),B=e=>Go.test(e),Be=()=>!0,Wo=e=>To.test(e)&&!Io.test(e),we=()=>!1,Fo=e=>Mo.test(e),No=e=>Oo.test(e),Do=e=>!s(e)&&!a(e),Bo=e=>e.startsWith("@container")&&(e[10]==="/"&&e[11]!==void 0||e[11]==="s"&&e[16]!==void 0&&e.startsWith("-size/",10)||e[11]==="n"&&e[18]!==void 0&&e.startsWith("-normal/",10)),Uo=e=>q(e,Ve,we),s=e=>Ne.test(e),oe=e=>q(e,He,Wo),Ge=e=>q(e,Ko,u),$o=e=>q(e,Xe,Be),Vo=e=>q(e,Ye,we),Te=e=>q(e,Ue,we),Ho=e=>q(e,$e,No),fe=e=>q(e,je,Fo),a=e=>De.test(e),ce=e=>te(e,He),Yo=e=>te(e,Ye),Ie=e=>te(e,Ue),Xo=e=>te(e,Ve),jo=e=>te(e,$e),ue=e=>te(e,je,!0),qo=e=>te(e,Xe,!0),q=(e,r,t)=>{let o=Ne.exec(e);return o?o[1]?r(o[1]):t(o[2]):!1},te=(e,r,t=!1)=>{let o=De.exec(e);return o?o[1]?r(o[1]):t:!1},Ue=e=>e==="position"||e==="percentage",$e=e=>e==="image"||e==="url",Ve=e=>e==="length"||e==="size"||e==="bg-size",He=e=>e==="length",Ko=e=>e==="number",Ye=e=>e==="family-name",Xe=e=>e==="number"||e==="weight",je=e=>e==="shadow";var Qo=()=>{let e=y("color"),r=y("font"),t=y("text"),o=y("font-weight"),i=y("tracking"),c=y("leading"),d=y("breakpoint"),p=y("container"),b=y("spacing"),m=y("radius"),k=y("shadow"),x=y("inset-shadow"),M=y("text-shadow"),P=y("drop-shadow"),U=y("blur"),L=y("perspective"),C=y("aspect"),N=y("ease"),_=y("animate"),$=()=>["auto","avoid","all","avoid-page","page","left","right","column"],V=()=>["center","top","bottom","left","right","top-left","left-top","top-right","right-top","bottom-right","right-bottom","bottom-left","left-bottom"],H=()=>[...V(),a,s],Y=()=>["auto","hidden","clip","visible","scroll"],G=()=>["auto","contain","none"],n=()=>[a,s,b],h=()=>[j,"full","auto",...n()],X=()=>[F,"none","subgrid",a,s],ne=()=>["auto",{span:["full",F,a,s]},F,a,s],A=()=>[F,"auto",a,s],O=()=>["auto","min","max","fr",a,s],T=()=>["start","end","center","between","around","evenly","stretch","baseline","center-safe","end-safe"],I=()=>["start","end","center","stretch","center-safe","end-safe"],f=()=>["auto",...n()],R=()=>[j,"auto","full","dvw","dvh","lvw","lvh","svw","svh","min","max","fit",...n()],D=()=>[j,"screen","full","dvw","lvw","svw","min","max","fit",...n()],se=()=>[j,"screen","full","lh","dvh","lvh","svh","min","max","fit",...n()],l=()=>[e,a,s],w=()=>[...V(),Ie,Te,{position:[a,s]}],de=()=>["no-repeat",{repeat:["","x","y","space","round"]}],K=()=>["auto","cover","contain",Xo,Uo,{size:[a,s]}],le=()=>[he,ce,oe],z=()=>["","none","full",m,a,s],S=()=>["",u,ce,oe],Q=()=>["solid","dashed","dotted","double"],W=()=>["normal","multiply","screen","overlay","darken","lighten","color-dodge","color-burn","hard-light","soft-light","difference","exclusion","hue","saturation","color","luminosity"],v=()=>[u,he,Ie,Te],E=()=>["","none",U,a,s],J=()=>["none",u,a,s],Z=()=>["none",u,a,s],ie=()=>[u,a,s],ee=()=>[j,"full",...n()];return{cacheSize:500,theme:{animate:["spin","ping","pulse","bounce"],aspect:["video"],blur:[B],breakpoint:[B],color:[Be],container:[B],"drop-shadow":[B],ease:["in","out","in-out"],font:[Do],"font-weight":["thin","extralight","light","normal","medium","semibold","bold","extrabold","black"],"inset-shadow":[B],leading:["none","tight","snug","normal","relaxed","loose"],perspective:["dramatic","near","normal","midrange","distant","none"],radius:[B],shadow:[B],spacing:["px",u],text:[B],"text-shadow":[B],tracking:["tighter","tight","normal","wide","wider","widest"]},classGroups:{aspect:[{aspect:["auto","square",j,s,a,C]}],container:["container"],"container-type":[{"@container":["","normal","size",a,s]}],"container-named":[Bo],columns:[{columns:[u,s,a,p]}],"break-after":[{"break-after":$()}],"break-before":[{"break-before":$()}],"break-inside":[{"break-inside":["auto","avoid","avoid-page","avoid-column"]}],"box-decoration":[{"box-decoration":["slice","clone"]}],box:[{box:["border","content"]}],display:["block","inline-block","inline","flex","inline-flex","table","inline-table","table-caption","table-cell","table-column","table-column-group","table-footer-group","table-header-group","table-row-group","table-row","flow-root","grid","inline-grid","contents","list-item","hidden"],sr:["sr-only","not-sr-only"],float:[{float:["right","left","none","start","end"]}],clear:[{clear:["left","right","both","none","start","end"]}],isolation:["isolate","isolation-auto"],"object-fit":[{object:["contain","cover","fill","none","scale-down"]}],"object-position":[{object:H()}],overflow:[{overflow:Y()}],"overflow-x":[{"overflow-x":Y()}],"overflow-y":[{"overflow-y":Y()}],overscroll:[{overscroll:G()}],"overscroll-x":[{"overscroll-x":G()}],"overscroll-y":[{"overscroll-y":G()}],position:["static","fixed","absolute","relative","sticky"],inset:[{inset:h()}],"inset-x":[{"inset-x":h()}],"inset-y":[{"inset-y":h()}],start:[{"inset-s":h(),start:h()}],end:[{"inset-e":h(),end:h()}],"inset-bs":[{"inset-bs":h()}],"inset-be":[{"inset-be":h()}],top:[{top:h()}],right:[{right:h()}],bottom:[{bottom:h()}],left:[{left:h()}],visibility:["visible","invisible","collapse"],z:[{z:[F,"auto",a,s]}],basis:[{basis:[j,"full","auto",p,...n()]}],"flex-direction":[{flex:["row","row-reverse","col","col-reverse"]}],"flex-wrap":[{flex:["nowrap","wrap","wrap-reverse"]}],flex:[{flex:[u,j,"auto","initial","none",s]}],grow:[{grow:["",u,a,s]}],shrink:[{shrink:["",u,a,s]}],order:[{order:[F,"first","last","none",a,s]}],"grid-cols":[{"grid-cols":X()}],"col-start-end":[{col:ne()}],"col-start":[{"col-start":A()}],"col-end":[{"col-end":A()}],"grid-rows":[{"grid-rows":X()}],"row-start-end":[{row:ne()}],"row-start":[{"row-start":A()}],"row-end":[{"row-end":A()}],"grid-flow":[{"grid-flow":["row","col","dense","row-dense","col-dense"]}],"auto-cols":[{"auto-cols":O()}],"auto-rows":[{"auto-rows":O()}],gap:[{gap:n()}],"gap-x":[{"gap-x":n()}],"gap-y":[{"gap-y":n()}],"justify-content":[{justify:[...T(),"normal"]}],"justify-items":[{"justify-items":[...I(),"normal"]}],"justify-self":[{"justify-self":["auto",...I()]}],"align-content":[{content:["normal",...T()]}],"align-items":[{items:[...I(),{baseline:["","last"]}]}],"align-self":[{self:["auto",...I(),{baseline:["","last"]}]}],"place-content":[{"place-content":T()}],"place-items":[{"place-items":[...I(),"baseline"]}],"place-self":[{"place-self":["auto",...I()]}],p:[{p:n()}],px:[{px:n()}],py:[{py:n()}],ps:[{ps:n()}],pe:[{pe:n()}],pbs:[{pbs:n()}],pbe:[{pbe:n()}],pt:[{pt:n()}],pr:[{pr:n()}],pb:[{pb:n()}],pl:[{pl:n()}],m:[{m:f()}],mx:[{mx:f()}],my:[{my:f()}],ms:[{ms:f()}],me:[{me:f()}],mbs:[{mbs:f()}],mbe:[{mbe:f()}],mt:[{mt:f()}],mr:[{mr:f()}],mb:[{mb:f()}],ml:[{ml:f()}],"space-x":[{"space-x":n()}],"space-x-reverse":["space-x-reverse"],"space-y":[{"space-y":n()}],"space-y-reverse":["space-y-reverse"],size:[{size:R()}],"inline-size":[{inline:["auto",...D()]}],"min-inline-size":[{"min-inline":["auto",...D()]}],"max-inline-size":[{"max-inline":["none",...D()]}],"block-size":[{block:["auto",...se()]}],"min-block-size":[{"min-block":["auto",...se()]}],"max-block-size":[{"max-block":["none",...se()]}],w:[{w:[p,"screen",...R()]}],"min-w":[{"min-w":[p,"screen","none",...R()]}],"max-w":[{"max-w":[p,"screen","none","prose",{screen:[d]},...R()]}],h:[{h:["screen","lh",...R()]}],"min-h":[{"min-h":["screen","lh","none",...R()]}],"max-h":[{"max-h":["screen","lh",...R()]}],"font-size":[{text:["base",t,ce,oe]}],"font-smoothing":["antialiased","subpixel-antialiased"],"font-style":["italic","not-italic"],"font-weight":[{font:[o,qo,$o]}],"font-stretch":[{"font-stretch":["ultra-condensed","extra-condensed","condensed","semi-condensed","normal","semi-expanded","expanded","extra-expanded","ultra-expanded",he,s]}],"font-family":[{font:[Yo,Vo,r]}],"font-features":[{"font-features":[s]}],"fvn-normal":["normal-nums"],"fvn-ordinal":["ordinal"],"fvn-slashed-zero":["slashed-zero"],"fvn-figure":["lining-nums","oldstyle-nums"],"fvn-spacing":["proportional-nums","tabular-nums"],"fvn-fraction":["diagonal-fractions","stacked-fractions"],tracking:[{tracking:[i,a,s]}],"line-clamp":[{"line-clamp":[u,"none",a,Ge]}],leading:[{leading:[c,...n()]}],"list-image":[{"list-image":["none",a,s]}],"list-style-position":[{list:["inside","outside"]}],"list-style-type":[{list:["disc","decimal","none",a,s]}],"text-alignment":[{text:["left","center","right","justify","start","end"]}],"placeholder-color":[{placeholder:l()}],"text-color":[{text:l()}],"text-decoration":["underline","overline","line-through","no-underline"],"text-decoration-style":[{decoration:[...Q(),"wavy"]}],"text-decoration-thickness":[{decoration:[u,"from-font","auto",a,oe]}],"text-decoration-color":[{decoration:l()}],"underline-offset":[{"underline-offset":[u,"auto",a,s]}],"text-transform":["uppercase","lowercase","capitalize","normal-case"],"text-overflow":["truncate","text-ellipsis","text-clip"],"text-wrap":[{text:["wrap","nowrap","balance","pretty"]}],indent:[{indent:n()}],"tab-size":[{tab:[F,a,s]}],"vertical-align":[{align:["baseline","top","middle","bottom","text-top","text-bottom","sub","super",a,s]}],whitespace:[{whitespace:["normal","nowrap","pre","pre-line","pre-wrap","break-spaces"]}],break:[{break:["normal","words","all","keep"]}],wrap:[{wrap:["break-word","anywhere","normal"]}],hyphens:[{hyphens:["none","manual","auto"]}],content:[{content:["none",a,s]}],"bg-attachment":[{bg:["fixed","local","scroll"]}],"bg-clip":[{"bg-clip":["border","padding","content","text"]}],"bg-origin":[{"bg-origin":["border","padding","content"]}],"bg-position":[{bg:w()}],"bg-repeat":[{bg:de()}],"bg-size":[{bg:K()}],"bg-image":[{bg:["none",{linear:[{to:["t","tr","r","br","b","bl","l","tl"]},F,a,s],radial:["",a,s],conic:[F,a,s]},jo,Ho]}],"bg-color":[{bg:l()}],"gradient-from-pos":[{from:le()}],"gradient-via-pos":[{via:le()}],"gradient-to-pos":[{to:le()}],"gradient-from":[{from:l()}],"gradient-via":[{via:l()}],"gradient-to":[{to:l()}],rounded:[{rounded:z()}],"rounded-s":[{"rounded-s":z()}],"rounded-e":[{"rounded-e":z()}],"rounded-t":[{"rounded-t":z()}],"rounded-r":[{"rounded-r":z()}],"rounded-b":[{"rounded-b":z()}],"rounded-l":[{"rounded-l":z()}],"rounded-ss":[{"rounded-ss":z()}],"rounded-se":[{"rounded-se":z()}],"rounded-ee":[{"rounded-ee":z()}],"rounded-es":[{"rounded-es":z()}],"rounded-tl":[{"rounded-tl":z()}],"rounded-tr":[{"rounded-tr":z()}],"rounded-br":[{"rounded-br":z()}],"rounded-bl":[{"rounded-bl":z()}],"border-w":[{border:S()}],"border-w-x":[{"border-x":S()}],"border-w-y":[{"border-y":S()}],"border-w-s":[{"border-s":S()}],"border-w-e":[{"border-e":S()}],"border-w-bs":[{"border-bs":S()}],"border-w-be":[{"border-be":S()}],"border-w-t":[{"border-t":S()}],"border-w-r":[{"border-r":S()}],"border-w-b":[{"border-b":S()}],"border-w-l":[{"border-l":S()}],"divide-x":[{"divide-x":S()}],"divide-x-reverse":["divide-x-reverse"],"divide-y":[{"divide-y":S()}],"divide-y-reverse":["divide-y-reverse"],"border-style":[{border:[...Q(),"hidden","none"]}],"divide-style":[{divide:[...Q(),"hidden","none"]}],"border-color":[{border:l()}],"border-color-x":[{"border-x":l()}],"border-color-y":[{"border-y":l()}],"border-color-s":[{"border-s":l()}],"border-color-e":[{"border-e":l()}],"border-color-bs":[{"border-bs":l()}],"border-color-be":[{"border-be":l()}],"border-color-t":[{"border-t":l()}],"border-color-r":[{"border-r":l()}],"border-color-b":[{"border-b":l()}],"border-color-l":[{"border-l":l()}],"divide-color":[{divide:l()}],"outline-style":[{outline:[...Q(),"none","hidden"]}],"outline-offset":[{"outline-offset":[u,a,s]}],"outline-w":[{outline:["",u,ce,oe]}],"outline-color":[{outline:l()}],shadow:[{shadow:["","none",k,ue,fe]}],"shadow-color":[{shadow:l()}],"inset-shadow":[{"inset-shadow":["none",x,ue,fe]}],"inset-shadow-color":[{"inset-shadow":l()}],"ring-w":[{ring:S()}],"ring-w-inset":["ring-inset"],"ring-color":[{ring:l()}],"ring-offset-w":[{"ring-offset":[u,oe]}],"ring-offset-color":[{"ring-offset":l()}],"inset-ring-w":[{"inset-ring":S()}],"inset-ring-color":[{"inset-ring":l()}],"text-shadow":[{"text-shadow":["none",M,ue,fe]}],"text-shadow-color":[{"text-shadow":l()}],opacity:[{opacity:[u,a,s]}],"mix-blend":[{"mix-blend":[...W(),"plus-darker","plus-lighter"]}],"bg-blend":[{"bg-blend":W()}],"mask-clip":[{"mask-clip":["border","padding","content","fill","stroke","view"]},"mask-no-clip"],"mask-composite":[{mask:["add","subtract","intersect","exclude"]}],"mask-image-linear-pos":[{"mask-linear":[u]}],"mask-image-linear-from-pos":[{"mask-linear-from":v()}],"mask-image-linear-to-pos":[{"mask-linear-to":v()}],"mask-image-linear-from-color":[{"mask-linear-from":l()}],"mask-image-linear-to-color":[{"mask-linear-to":l()}],"mask-image-t-from-pos":[{"mask-t-from":v()}],"mask-image-t-to-pos":[{"mask-t-to":v()}],"mask-image-t-from-color":[{"mask-t-from":l()}],"mask-image-t-to-color":[{"mask-t-to":l()}],"mask-image-r-from-pos":[{"mask-r-from":v()}],"mask-image-r-to-pos":[{"mask-r-to":v()}],"mask-image-r-from-color":[{"mask-r-from":l()}],"mask-image-r-to-color":[{"mask-r-to":l()}],"mask-image-b-from-pos":[{"mask-b-from":v()}],"mask-image-b-to-pos":[{"mask-b-to":v()}],"mask-image-b-from-color":[{"mask-b-from":l()}],"mask-image-b-to-color":[{"mask-b-to":l()}],"mask-image-l-from-pos":[{"mask-l-from":v()}],"mask-image-l-to-pos":[{"mask-l-to":v()}],"mask-image-l-from-color":[{"mask-l-from":l()}],"mask-image-l-to-color":[{"mask-l-to":l()}],"mask-image-x-from-pos":[{"mask-x-from":v()}],"mask-image-x-to-pos":[{"mask-x-to":v()}],"mask-image-x-from-color":[{"mask-x-from":l()}],"mask-image-x-to-color":[{"mask-x-to":l()}],"mask-image-y-from-pos":[{"mask-y-from":v()}],"mask-image-y-to-pos":[{"mask-y-to":v()}],"mask-image-y-from-color":[{"mask-y-from":l()}],"mask-image-y-to-color":[{"mask-y-to":l()}],"mask-image-radial":[{"mask-radial":[a,s]}],"mask-image-radial-from-pos":[{"mask-radial-from":v()}],"mask-image-radial-to-pos":[{"mask-radial-to":v()}],"mask-image-radial-from-color":[{"mask-radial-from":l()}],"mask-image-radial-to-color":[{"mask-radial-to":l()}],"mask-image-radial-shape":[{"mask-radial":["circle","ellipse"]}],"mask-image-radial-size":[{"mask-radial":[{closest:["side","corner"],farthest:["side","corner"]}]}],"mask-image-radial-pos":[{"mask-radial-at":V()}],"mask-image-conic-pos":[{"mask-conic":[u]}],"mask-image-conic-from-pos":[{"mask-conic-from":v()}],"mask-image-conic-to-pos":[{"mask-conic-to":v()}],"mask-image-conic-from-color":[{"mask-conic-from":l()}],"mask-image-conic-to-color":[{"mask-conic-to":l()}],"mask-mode":[{mask:["alpha","luminance","match"]}],"mask-origin":[{"mask-origin":["border","padding","content","fill","stroke","view"]}],"mask-position":[{mask:w()}],"mask-repeat":[{mask:de()}],"mask-size":[{mask:K()}],"mask-type":[{"mask-type":["alpha","luminance"]}],"mask-image":[{mask:["none",a,s]}],filter:[{filter:["","none",a,s]}],blur:[{blur:E()}],brightness:[{brightness:[u,a,s]}],contrast:[{contrast:[u,a,s]}],"drop-shadow":[{"drop-shadow":["","none",P,ue,fe]}],"drop-shadow-color":[{"drop-shadow":l()}],grayscale:[{grayscale:["",u,a,s]}],"hue-rotate":[{"hue-rotate":[u,a,s]}],invert:[{invert:["",u,a,s]}],saturate:[{saturate:[u,a,s]}],sepia:[{sepia:["",u,a,s]}],"backdrop-filter":[{"backdrop-filter":["","none",a,s]}],"backdrop-blur":[{"backdrop-blur":E()}],"backdrop-brightness":[{"backdrop-brightness":[u,a,s]}],"backdrop-contrast":[{"backdrop-contrast":[u,a,s]}],"backdrop-grayscale":[{"backdrop-grayscale":["",u,a,s]}],"backdrop-hue-rotate":[{"backdrop-hue-rotate":[u,a,s]}],"backdrop-invert":[{"backdrop-invert":["",u,a,s]}],"backdrop-opacity":[{"backdrop-opacity":[u,a,s]}],"backdrop-saturate":[{"backdrop-saturate":[u,a,s]}],"backdrop-sepia":[{"backdrop-sepia":["",u,a,s]}],"border-collapse":[{border:["collapse","separate"]}],"border-spacing":[{"border-spacing":n()}],"border-spacing-x":[{"border-spacing-x":n()}],"border-spacing-y":[{"border-spacing-y":n()}],"table-layout":[{table:["auto","fixed"]}],caption:[{caption:["top","bottom"]}],transition:[{transition:["","all","colors","opacity","shadow","transform","none",a,s]}],"transition-behavior":[{transition:["normal","discrete"]}],duration:[{duration:[u,"initial",a,s]}],ease:[{ease:["linear","initial",N,a,s]}],delay:[{delay:[u,a,s]}],animate:[{animate:["none",_,a,s]}],backface:[{backface:["hidden","visible"]}],perspective:[{perspective:[L,a,s]}],"perspective-origin":[{"perspective-origin":H()}],rotate:[{rotate:J()}],"rotate-x":[{"rotate-x":J()}],"rotate-y":[{"rotate-y":J()}],"rotate-z":[{"rotate-z":J()}],scale:[{scale:Z()}],"scale-x":[{"scale-x":Z()}],"scale-y":[{"scale-y":Z()}],"scale-z":[{"scale-z":Z()}],"scale-3d":["scale-3d"],skew:[{skew:ie()}],"skew-x":[{"skew-x":ie()}],"skew-y":[{"skew-y":ie()}],transform:[{transform:[a,s,"","none","gpu","cpu"]}],"transform-origin":[{origin:H()}],"transform-style":[{transform:["3d","flat"]}],translate:[{translate:ee()}],"translate-x":[{"translate-x":ee()}],"translate-y":[{"translate-y":ee()}],"translate-z":[{"translate-z":ee()}],"translate-none":["translate-none"],zoom:[{zoom:[F,a,s]}],accent:[{accent:l()}],appearance:[{appearance:["none","auto"]}],"caret-color":[{caret:l()}],"color-scheme":[{scheme:["normal","dark","light","light-dark","only-dark","only-light"]}],cursor:[{cursor:["auto","default","pointer","wait","text","move","help","not-allowed","none","context-menu","progress","cell","crosshair","vertical-text","alias","copy","no-drop","grab","grabbing","all-scroll","col-resize","row-resize","n-resize","e-resize","s-resize","w-resize","ne-resize","nw-resize","se-resize","sw-resize","ew-resize","ns-resize","nesw-resize","nwse-resize","zoom-in","zoom-out",a,s]}],"field-sizing":[{"field-sizing":["fixed","content"]}],"pointer-events":[{"pointer-events":["auto","none"]}],resize:[{resize:["none","","y","x"]}],"scroll-behavior":[{scroll:["auto","smooth"]}],"scrollbar-thumb-color":[{"scrollbar-thumb":l()}],"scrollbar-track-color":[{"scrollbar-track":l()}],"scrollbar-gutter":[{"scrollbar-gutter":["auto","stable","both"]}],"scrollbar-w":[{scrollbar:["auto","thin","none"]}],"scroll-m":[{"scroll-m":n()}],"scroll-mx":[{"scroll-mx":n()}],"scroll-my":[{"scroll-my":n()}],"scroll-ms":[{"scroll-ms":n()}],"scroll-me":[{"scroll-me":n()}],"scroll-mbs":[{"scroll-mbs":n()}],"scroll-mbe":[{"scroll-mbe":n()}],"scroll-mt":[{"scroll-mt":n()}],"scroll-mr":[{"scroll-mr":n()}],"scroll-mb":[{"scroll-mb":n()}],"scroll-ml":[{"scroll-ml":n()}],"scroll-p":[{"scroll-p":n()}],"scroll-px":[{"scroll-px":n()}],"scroll-py":[{"scroll-py":n()}],"scroll-ps":[{"scroll-ps":n()}],"scroll-pe":[{"scroll-pe":n()}],"scroll-pbs":[{"scroll-pbs":n()}],"scroll-pbe":[{"scroll-pbe":n()}],"scroll-pt":[{"scroll-pt":n()}],"scroll-pr":[{"scroll-pr":n()}],"scroll-pb":[{"scroll-pb":n()}],"scroll-pl":[{"scroll-pl":n()}],"snap-align":[{snap:["start","end","center","align-none"]}],"snap-stop":[{snap:["normal","always"]}],"snap-type":[{snap:["none","x","y","both"]}],"snap-strictness":[{snap:["mandatory","proximity"]}],touch:[{touch:["auto","none","manipulation"]}],"touch-x":[{"touch-pan":["x","left","right"]}],"touch-y":[{"touch-pan":["y","up","down"]}],"touch-pz":["touch-pinch-zoom"],select:[{select:["none","text","all","auto"]}],"will-change":[{"will-change":["auto","scroll","contents","transform",a,s]}],fill:[{fill:["none",...l()]}],"stroke-w":[{stroke:[u,ce,oe,Ge]}],stroke:[{stroke:["none",...l()]}],"forced-color-adjust":[{"forced-color-adjust":["auto","none"]}]},conflictingClassGroups:{"container-named":["container-type"],overflow:["overflow-x","overflow-y"],overscroll:["overscroll-x","overscroll-y"],inset:["inset-x","inset-y","inset-bs","inset-be","start","end","top","right","bottom","left"],"inset-x":["right","left"],"inset-y":["top","bottom"],flex:["basis","grow","shrink"],gap:["gap-x","gap-y"],p:["px","py","ps","pe","pbs","pbe","pt","pr","pb","pl"],px:["pr","pl"],py:["pt","pb"],m:["mx","my","ms","me","mbs","mbe","mt","mr","mb","ml"],mx:["mr","ml"],my:["mt","mb"],size:["w","h"],"font-size":["leading"],"fvn-normal":["fvn-ordinal","fvn-slashed-zero","fvn-figure","fvn-spacing","fvn-fraction"],"fvn-ordinal":["fvn-normal"],"fvn-slashed-zero":["fvn-normal"],"fvn-figure":["fvn-normal"],"fvn-spacing":["fvn-normal"],"fvn-fraction":["fvn-normal"],"line-clamp":["display","overflow"],rounded:["rounded-s","rounded-e","rounded-t","rounded-r","rounded-b","rounded-l","rounded-ss","rounded-se","rounded-ee","rounded-es","rounded-tl","rounded-tr","rounded-br","rounded-bl"],"rounded-s":["rounded-ss","rounded-es"],"rounded-e":["rounded-se","rounded-ee"],"rounded-t":["rounded-tl","rounded-tr"],"rounded-r":["rounded-tr","rounded-br"],"rounded-b":["rounded-br","rounded-bl"],"rounded-l":["rounded-tl","rounded-bl"],"border-spacing":["border-spacing-x","border-spacing-y"],"border-w":["border-w-x","border-w-y","border-w-s","border-w-e","border-w-bs","border-w-be","border-w-t","border-w-r","border-w-b","border-w-l"],"border-w-x":["border-w-r","border-w-l"],"border-w-y":["border-w-t","border-w-b"],"border-color":["border-color-x","border-color-y","border-color-s","border-color-e","border-color-bs","border-color-be","border-color-t","border-color-r","border-color-b","border-color-l"],"border-color-x":["border-color-r","border-color-l"],"border-color-y":["border-color-t","border-color-b"],translate:["translate-x","translate-y","translate-none"],"translate-none":["translate","translate-x","translate-y","translate-z"],"scroll-m":["scroll-mx","scroll-my","scroll-ms","scroll-me","scroll-mbs","scroll-mbe","scroll-mt","scroll-mr","scroll-mb","scroll-ml"],"scroll-mx":["scroll-mr","scroll-ml"],"scroll-my":["scroll-mt","scroll-mb"],"scroll-p":["scroll-px","scroll-py","scroll-ps","scroll-pe","scroll-pbs","scroll-pbe","scroll-pt","scroll-pr","scroll-pb","scroll-pl"],"scroll-px":["scroll-pr","scroll-pl"],"scroll-py":["scroll-pt","scroll-pb"],touch:["touch-x","touch-y","touch-pz"],"touch-x":["touch"],"touch-y":["touch"],"touch-pz":["touch"]},conflictingClassGroupModifiers:{"font-size":["leading"]},postfixLookupClassGroups:["container-type"],orderSensitiveModifiers:["*","**","after","backdrop","before","details-content","file","first-letter","first-line","marker","placeholder","selection"]}};var qe=Ao(Qo);function ye(...e){return qe(Pe(e))}import{jsx as ae,jsxs as ro}from"react/jsx-runtime";var no=15,Zo=3,et=.5,ot=.9,tt=.92,rt=-.5,nt=6,st=-2,Qe=89,it=2,Je=1,so=200,io="retro-grid-fallback-scroll",at=`
@keyframes ${io} {
  from {
    transform: translateY(-50%);
  }

  to {
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-retro-grid-scroll="true"] {
    animation: none !important;
    transform: translateY(-50%) !important;
  }
}
`,lt=`
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`,ct=`
#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform vec2 u_container_size;
uniform vec2 u_viewport_size;
uniform vec4 u_line_color;
uniform float u_angle;
uniform float u_cell_size;
uniform float u_device_pixel_ratio;
uniform float u_time;

const float animationDurationSeconds = ${no.toFixed(1)};
const float gridHeightRatio = ${Zo.toFixed(1)};
const float gridStartOffsetRatio = ${rt.toFixed(1)};
const float gridWidthRatio = ${nt.toFixed(1)};
const float gridXOffsetRatio = ${st.toFixed(1)};
const float gridLineAlignmentOffsetPx = ${et.toFixed(1)};
const float gridLineAntialiasMultiplier = ${ot.toFixed(1)};
const float horizontalLodLevelOneEndPx = 5.6;
const float horizontalLodLevelOneStartPx = 2.8;
const float horizontalLodLevelTwoEndPx = 3.0;
const float horizontalLodLevelTwoStartPx = 1.4;
const float horizontalCompressionEndPx = 2.8;
const float horizontalCompressionStartPx = 1.2;
const float lineWidthPx = ${tt.toFixed(2)};
const float perspectivePx = ${so.toFixed(1)};
const float gridTravelRatio = 0.5;
const float verticalCompressionEndPx = 2.6;
const float verticalCompressionStartPx = 1.0;
const float verticalEdgeCompressionEnd = 0.95;
const float verticalEdgeCompressionStart = 0.45;
const float verticalLodLevelEnd = 0.64;
const float verticalLodLevelStart = 0.22;
const float verticalTopCompressionEndCells = 6.0;
const float verticalTopCompressionStartCells = 2.0;

float renderGridLine(
  float wrappedCoord,
  float antiAliasWidth,
  float softnessBoost
) {
  return 1.0 - smoothstep(
    lineWidthPx,
    lineWidthPx + (antiAliasWidth * (1.5 + softnessBoost)),
    wrappedCoord
  );
}

void main() {
  float angle = radians(clamp(u_angle, 1.0, 89.0));
  float sinAngle = sin(angle);
  float cosAngle = cos(angle);
  vec2 screen = vec2(
    (gl_FragCoord.x / u_device_pixel_ratio) - (u_container_size.x * 0.5),
    (u_container_size.y * 0.5) - (gl_FragCoord.y / u_device_pixel_ratio)
  );

  vec3 rayOrigin = vec3(0.0, 0.0, perspectivePx);
  vec3 rayDirection = normalize(vec3(screen, -perspectivePx));
  vec3 planeXAxis = vec3(1.0, 0.0, 0.0);
  vec3 planeYAxis = vec3(0.0, cosAngle, sinAngle);
  vec3 planeNormal = normalize(cross(planeXAxis, planeYAxis));
  float denominator = dot(rayDirection, planeNormal);

  if (abs(denominator) < 0.0001) {
    discard;
  }

  float distanceToPlane = dot(-rayOrigin, planeNormal) / denominator;

  if (distanceToPlane <= 0.0) {
    discard;
  }

  vec3 hitPoint = rayOrigin + (rayDirection * distanceToPlane);
  float localX = hitPoint.x;
  float localY = dot(hitPoint, planeYAxis);
  float gridWidth = u_viewport_size.x * gridWidthRatio;
  float gridHeight = u_viewport_size.y * gridHeightRatio;
  float gridScrollSpeed = (gridHeight * gridTravelRatio) / animationDurationSeconds;
  float patternOffsetY = u_time * gridScrollSpeed;
  float gridLeft = (-0.5 * u_container_size.x) + (gridXOffsetRatio * u_container_size.x);
  float gridTop = (-0.5 * u_container_size.y) + (gridStartOffsetRatio * gridHeight);
  vec2 planePosition = vec2(localX - gridLeft, localY - gridTop);

  if (
    planePosition.x < 0.0 ||
    planePosition.y < 0.0 ||
    planePosition.x > gridWidth ||
    planePosition.y > gridHeight
  ) {
    discard;
  }

  vec2 patternPosition = vec2(planePosition.x, planePosition.y - patternOffsetY);
  vec2 wrapped = mod(
    patternPosition + vec2(gridLineAlignmentOffsetPx),
    u_cell_size
  );
  vec2 patternDerivative = max(fwidth(patternPosition), vec2(0.0001));
  vec2 antiAliasWidth = patternDerivative * gridLineAntialiasMultiplier;
  float horizontalCellSpanPx = u_cell_size / patternDerivative.y;
  float horizontalCompression = 1.0 - smoothstep(
    horizontalCompressionStartPx,
    horizontalCompressionEndPx,
    horizontalCellSpanPx
  );
  float verticalCellSpanPx = u_cell_size / patternDerivative.x;
  float sideDistance = abs((planePosition.x / gridWidth) * 2.0 - 1.0);
  float verticalEdgeCompression = smoothstep(
    verticalEdgeCompressionStart,
    verticalEdgeCompressionEnd,
    sideDistance
  );
  float verticalTopCompression = 1.0 - smoothstep(
    u_cell_size * verticalTopCompressionStartCells,
    u_cell_size * verticalTopCompressionEndCells,
    planePosition.y
  );
  float verticalCompression =
    (1.0 - smoothstep(
      verticalCompressionStartPx,
      verticalCompressionEndPx,
      verticalCellSpanPx
    )) * verticalEdgeCompression * verticalTopCompression;
  float horizontalSoftnessBoost = 1.0 + (horizontalCompression * 3.0);
  float verticalSoftnessBoost = 1.0 + (verticalCompression * 3.5);
  float verticalLod = smoothstep(
    verticalLodLevelStart,
    verticalLodLevelEnd,
    verticalCompression
  );
  float verticalLineFine = renderGridLine(
    wrapped.x,
    antiAliasWidth.x,
    verticalSoftnessBoost
  );
  float verticalWrappedLod = mod(
    patternPosition.x + gridLineAlignmentOffsetPx,
    u_cell_size * 2.0
  );
  float verticalLineCoarse = renderGridLine(
    verticalWrappedLod,
    antiAliasWidth.x,
    verticalSoftnessBoost + verticalLod
  );
  float verticalLine = max(
    verticalLineFine * (1.0 - verticalLod),
    verticalLineCoarse * verticalLod
  );
  float horizontalLodLevelOne = 1.0 - smoothstep(
    horizontalLodLevelOneStartPx,
    horizontalLodLevelOneEndPx,
    horizontalCellSpanPx
  );
  float horizontalLodLevelTwo = 1.0 - smoothstep(
    horizontalLodLevelTwoStartPx,
    horizontalLodLevelTwoEndPx,
    horizontalCellSpanPx
  );
  float horizontalLineFine = renderGridLine(
    wrapped.y,
    antiAliasWidth.y,
    horizontalSoftnessBoost
  );
  float horizontalWrappedLodOne = mod(
    patternPosition.y + gridLineAlignmentOffsetPx,
    u_cell_size * 2.0
  );
  float horizontalWrappedLodTwo = mod(
    patternPosition.y + gridLineAlignmentOffsetPx,
    u_cell_size * 4.0
  );
  float horizontalLineCoarse = renderGridLine(
    horizontalWrappedLodOne,
    antiAliasWidth.y,
    horizontalSoftnessBoost + horizontalLodLevelOne
  );
  float horizontalLineExtraCoarse = renderGridLine(
    horizontalWrappedLodTwo,
    antiAliasWidth.y,
    horizontalSoftnessBoost + horizontalLodLevelOne + horizontalLodLevelTwo
  );
  float horizontalLineReduced = max(
    horizontalLineFine * (1.0 - horizontalLodLevelOne),
    horizontalLineCoarse * horizontalLodLevelOne
  );
  float horizontalLine = max(
    horizontalLineReduced * (1.0 - horizontalLodLevelTwo),
    horizontalLineExtraCoarse * horizontalLodLevelTwo
  );
  float line = max(verticalLine, horizontalLine);

  if (line <= 0.001) {
    discard;
  }

  float alpha = u_line_color.a * line;
  gl_FragColor = vec4(u_line_color.rgb * alpha, alpha);
}
`,be;function Ze(e,r,t){return Math.min(Math.max(e,r),t)}function eo(e,r,t){let o=e.createShader(r);return o?(e.shaderSource(o,t),e.compileShader(o),e.getShaderParameter(o,e.COMPILE_STATUS)?o:(e.deleteShader(o),null)):null}function dt(e){let r=eo(e,e.VERTEX_SHADER,lt),t=eo(e,e.FRAGMENT_SHADER,ct);if(!r||!t)return null;let o=e.createProgram();return o?(e.attachShader(o,r),e.attachShader(o,t),e.linkProgram(o),e.deleteShader(r),e.deleteShader(t),e.getProgramParameter(o,e.LINK_STATUS)?o:(e.deleteProgram(o),null)):(e.deleteShader(r),e.deleteShader(t),null)}function mt(e,r){let t=e.getAttribLocation(r,"a_position"),o=e.getUniformLocation(r,"u_angle"),i=e.getUniformLocation(r,"u_cell_size"),c=e.getUniformLocation(r,"u_container_size"),d=e.getUniformLocation(r,"u_device_pixel_ratio"),p=e.getUniformLocation(r,"u_line_color"),b=e.getUniformLocation(r,"u_time"),m=e.getUniformLocation(r,"u_viewport_size");return t<0||!o||!i||!c||!d||!p||!b||!m?null:{attributeLocation:t,program:r,uniforms:{angle:o,cellSize:i,containerSize:c,devicePixelRatio:d,lineColor:p,time:b,viewportSize:m}}}function ft(e){let r=document.documentElement;return r.classList.contains("dark")?!0:r.classList.contains("light")?!1:e.matches}function ut(){if(be!==void 0)return be;let e=document.createElement("canvas");return e.width=1,e.height=1,be=e.getContext("2d",{willReadFrequently:!0}),be}function oo(e,r){let t=document.createElement("span");t.style.color=e,t.style.opacity="0",t.style.pointerEvents="none",t.style.position="absolute",r.appendChild(t);let o=getComputedStyle(t).color;t.remove();let i=ut();if(!i)return new Float32Array([.5,.5,.5,1]);i.clearRect(0,0,1,1),i.fillStyle=o,i.fillRect(0,0,1,1);let c=i.getImageData(0,0,1,1).data;return new Float32Array([c[0]/255,c[1]/255,c[2]/255,c[3]/255])}function to(e,r){return{animation:`${io} ${no}s linear infinite`,backgroundImage:`linear-gradient(to right, ${r} 1px, transparent 0), linear-gradient(to bottom, ${r} 1px, transparent 0)`,backgroundRepeat:"repeat",backgroundSize:`${e}px ${e}px`,transform:"translateY(-50%)"}}function yt({className:e,angle:r=65,cellSize:t=60,opacity:o=.5,lightLineColor:i="gray",darkLineColor:c="gray",style:d,...p}){let b=re(null),m=re(null),[k,x]=Jo(!1),M=re(r),P=re(t),U=re(c),L=re(i),C=re(null);Ke(()=>{M.current=r,P.current=t,U.current=c,L.current=i,C.current?.()},[r,t,c,i]),Ke(()=>{let n=b.current,h=m.current;if(!n||!h)return;let X=window.matchMedia("(prefers-reduced-motion: reduce)"),ne=window.matchMedia("(prefers-color-scheme: dark)"),A=null,O=0,T=0,I=1,f=null,R=!0,D=!1,se=oo(L.current,h),l=null,w=null,de=()=>{let g=n.getContext("webgl",{alpha:!0,antialias:!0,premultipliedAlpha:!0});return!g||!g.getExtension("OES_standard_derivatives")?null:g},K=g=>{g&&f&&(l&&f.deleteBuffer(l),w&&f.deleteProgram(w.program)),l=null,w=null,g&&(f=null)},le=()=>{let g=de();if(!g)return K(!1),!1;f=g,K(!0),f=g;let me=dt(g);if(!me)return!1;let Ce=mt(g,me);if(!Ce)return g.deleteProgram(me),!1;let ge=g.createBuffer();return ge?(g.bindBuffer(g.ARRAY_BUFFER,ge),g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),g.STATIC_DRAW),l=ge,w=Ce,!0):(g.deleteProgram(me),!1)},z=()=>{let g=ft(ne)?U.current:L.current;se=oo(g,h)},S=()=>{O=Math.floor(h.clientWidth),T=Math.floor(h.clientHeight),!(O===0||T===0||!f)&&(I=Math.min(window.devicePixelRatio||1,it),n.width=Math.floor(O*I),n.height=Math.floor(T*I),n.style.width=`${O}px`,n.style.height=`${T}px`,f.viewport(0,0,n.width,n.height))},Q=g=>{O===0||T===0||!f||!l||!w||D||(f.useProgram(w.program),f.bindBuffer(f.ARRAY_BUFFER,l),f.enableVertexAttribArray(w.attributeLocation),f.vertexAttribPointer(w.attributeLocation,2,f.FLOAT,!1,0,0),f.clearColor(0,0,0,0),f.clear(f.COLOR_BUFFER_BIT),f.uniform1f(w.uniforms.angle,Ze(M.current,Je,Qe)),f.uniform1f(w.uniforms.cellSize,Math.max(P.current,1)),f.uniform2f(w.uniforms.containerSize,O,T),f.uniform1f(w.uniforms.devicePixelRatio,I),f.uniform4fv(w.uniforms.lineColor,se),f.uniform1f(w.uniforms.time,X.matches?0:g/1e3),f.uniform2f(w.uniforms.viewportSize,window.innerWidth,window.innerHeight),f.drawArrays(f.TRIANGLES,0,3))},W=()=>{A!==null&&(cancelAnimationFrame(A),A=null)},v=g=>{if(Q(g),!X.matches&&R){A=requestAnimationFrame(v);return}A=null},E=()=>{if(D){W(),x(!1);return}if((!f||!l||!w)&&!le()){W(),x(!1);return}if(S(),O===0||T===0){W();return}if(z(),Q(performance.now()),x(!0),X.matches||!R){W();return}A===null&&(A=requestAnimationFrame(v))};C.current=E;let J=new ResizeObserver(()=>{E()});J.observe(h);let Z=()=>{E()},ie=new IntersectionObserver(([g])=>{if(R=g?.isIntersecting??!1,R){E();return}W()});ie.observe(h);let ee=new MutationObserver(()=>{E()});ee.observe(document.documentElement,{attributeFilter:["class"],attributes:!0});let ke=()=>{E()},Le=()=>{E()},ze=g=>{g.preventDefault(),D=!0,W(),K(!1),x(!1)},Se=()=>{D=!1,E()};return X.addEventListener("change",ke),ne.addEventListener("change",Le),window.addEventListener("resize",Z),n.addEventListener("webglcontextlost",ze),n.addEventListener("webglcontextrestored",Se),E(),()=>{W(),J.disconnect(),ie.disconnect(),ee.disconnect(),X.removeEventListener("change",ke),ne.removeEventListener("change",Le),window.removeEventListener("resize",Z),n.removeEventListener("webglcontextlost",ze),n.removeEventListener("webglcontextrestored",Se),C.current=null,K(!D)}},[]);let N={...d,opacity:o},_=Ze(r,Je,Qe),$=Math.max(t,1),V={perspective:`${so}px`},H={transform:`rotateX(${_}deg)`},Y=to($,i),G=to($,c);return ro("div",{ref:m,className:ye("pointer-events-none absolute size-full overflow-hidden",e),style:N,...p,children:[ae("style",{children:at}),k?null:ae("div",{className:"absolute inset-0",style:V,children:ro("div",{className:"absolute inset-0",style:H,children:[ae("div",{"data-retro-grid-scroll":"true",className:"absolute inset-[0%_0px] ml-[-200%] h-[300vh] w-[600vw] origin-[100%_0_0] dark:hidden",style:Y}),ae("div",{"data-retro-grid-scroll":"true",className:"absolute inset-[0%_0px] ml-[-200%] hidden h-[300vh] w-[600vw] origin-[100%_0_0] dark:block",style:G})]})}),ae("canvas",{ref:b,className:ye("absolute inset-0 size-full",k?"opacity-100":"opacity-0")}),ae("div",{className:"absolute inset-0 bg-linear-to-t from-white to-transparent to-90% dark:from-black"})]})}export{yt as RetroGrid};
