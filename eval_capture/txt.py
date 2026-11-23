import re,html,sys
t=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
links=set(re.findall(r'href="(https?://[^"]+)"',t))
t=re.sub(r'(?s)<script.*?</script>|<style.*?</style>','',t)
t=re.sub(r'<[^>]+>',' ',t); t=html.unescape(t); t=re.sub(r'\s+',' ',t)
kws=sys.argv[2].split('|')
for kw in kws:
    for m in list(re.finditer(kw,t))[:3]: print('...',t[max(0,m.start()-300):m.start()+400])
if len(sys.argv)>3:
    print([l for l in links if re.search(sys.argv[3],l)][:15])
