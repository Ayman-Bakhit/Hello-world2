from datetime import date,timedelta
D=lambda m,d:date(2026,m,d)
for d in [D(11,24),D(11,26),D(11,27),D(12,1),D(12,8),D(12,15),D(12,18)]: print(d,d.strftime('%a'))
fee=lambda a:round(a*0.029+0.30,2)
c=2400; f=fee(c); net=c-f; print('fee/charge',f,'net',net,'total fees',2*f)
rev=4800; costs=2600+360+120; print('profit',rev-2*f-costs)
print('7-14 day window',D(11,24)+timedelta(7),D(11,24)+timedelta(14))
def sched(arrive):
  ev={D(11,27):-2600,D(12,1):-120,D(12,15):-360}
  ev[arrive]=ev.get(arrive,0)+net
  bal=900;low=bal;out=[]
  d=D(11,23)
  while d<=D(12,18):
    if d in ev: bal=round(bal+ev[d],2); out.append((str(d),ev[d],bal)); low=min(low,bal)
    d+=timedelta(1)
  return out,low
for a in [D(11,27),D(12,1),D(12,8)]:
  o,l=sched(a); print('payout',a,'min',l); [print('  ',x) for x in o]
print('end incl pending',900+rev-2*f-costs)
