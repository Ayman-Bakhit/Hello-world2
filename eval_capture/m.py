import math
P=125; fee=0.029*P+0.30; cons=24; miles=36
for label,rate in [("actual $0.48",0.48),("IRS 72.5c (worksheet)",0.725),("IRS 76c (Jul-Dec 2026)",0.76)]:
    veh=miles*rate; cm=P-fee-cons-veh
    n=40; contrib=n*cm-425
    be=425/cm; tgt=(3000+425)/cm
    print(f"{label}: fee={fee:.4f} veh={veh:.2f} CM/appt={cm:.4f} 40appts contrib={contrib:.2f} BE={be:.3f}->{math.ceil(be)} target={tgt:.3f}->{math.ceil(tgt)} weekly={math.ceil(tgt)/4}")
# capacity
hrs_per=3.25; avail=45-10
print("weekly delivery hrs at 10/wk", 10*hrs_per, "util of 35:", 10*hrs_per/35, "of 45:", (10*hrs_per+10)/45)
print("max appts/wk", avail/hrs_per, math.floor(avail/hrs_per))
cm=P-fee-cons-36*0.48
print("max monthly contrib at 10/wk x4", 40*cm-425, "at 4.33 wks", 43*cm-425)
# sensitivity: price needed for 3000 at 40 appts
# P - 0.029P -0.3 -24 -17.28 = 3425/40
need=3425/40; Preq=(need+0.30+24+17.28)/0.971; print("price needed at 40 appts", Preq)
# appts needed at lower prices
for p in [100,110,115,125]:
    c=p-(0.029*p+0.3)-24-17.28; print(p, round(c,2), math.ceil(3425/c))
# cost sensitivity: consumables+10%, miles 45
c2=P-fee-24-45*0.48; print("45 miles", round(c2,2), math.ceil(3425/c2), 40*c2-425)
# refunds/no-show: 10% of booked as no-shows with stripe fee not refunded? keep simple
# hourly
print("contrib per delivery hr", cm/3.25, "per total hr at 45h", (40*cm-425)/(45*4))
