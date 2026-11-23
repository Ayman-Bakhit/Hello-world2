from decimal import Decimal as D, ROUND_FLOOR
P=D('0.260'); PR=D('0.19'); CAP=D('250')
n=180
print("Proposed (if eligible): print",n*PR,"postage",n*P,"total",n*(PR+P),"headroom",CAP-n*(PR+P))
print("Min legal EDDM qty 200 @0.19:",200*(PR+P))
nmax=(CAP/(PR+P)).to_integral_value(ROUND_FLOOR); print("Max N at $0.19 print, $0 fixed:",nmax, "cost",nmax*(PR+P))
for F in [0,25,50]:
    print(f" fixed ${F}: max N =",((CAP-F)/(PR+P)).to_integral_value(ROUND_FLOOR))
print("Max print price per piece p = (250 - F)/N - 0.26:")
for N in [200,250,300,350,400,450,500,555]:
    print(N, [str(((CAP-D(F))/N-P).quantize(D('0.0001'))) for F in (0,25,50)])
# weight scaling at constant stock
for h in ['6.25','6.5']:
    print("weight",h,"x9:", (D('0.7')*D(h)/6).quantize(D('0.001')),"oz")
print("FCM stamped letter alt 180 pcs:", 180*(PR+D('0.82')), " metered:",180*(PR+D('0.78')))
