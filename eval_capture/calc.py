import math
P,apr,n=12000,0.10,36
r=apr/12
pmt=P*r/(1-(1+r)**-n)
print(f"Payment: {pmt:.4f}/mo; total paid {pmt*n:,.2f}; interest {pmt*n-P:,.2f}")
price,vc,fixed,units,goal=170,115,1850,60,2000
cm=price-vc
contrib=cm*units
print(f"CM/unit {cm}; contribution@60 {contrib:,}; less fixed -> {contrib-fixed:,} before debt; less debt -> {contrib-fixed-pmt:,.2f}")
for label,debt in [("no debt",0),("with $12k@10%/36",pmt)]:
    need=fixed+debt+goal
    u=need/cm
    print(f"{label}: need {need:,.2f}/mo contribution -> {u:.3f} units -> threshold {math.ceil(u)} units; founder cash @ ceil = {math.ceil(u)*cm-fixed-debt:,.2f}; @ceil-1 = {(math.ceil(u)-1)*cm-fixed-debt:,.2f}")
    print(f"   revenue at threshold ${math.ceil(u)*price:,}; vs plan 60 units gap {math.ceil(u)-60} units ({(math.ceil(u)/60-1)*100:.1f}%)")
# break-even (founder cash = 0)
for label,debt in [("no debt",0),("with debt",pmt)]:
    print(f"break-even {label}: {math.ceil((fixed+debt)/cm)} units")
# sensitivity at 60 units: price needed, VC allowed
print(f"price needed at 60u w/ debt: {(fixed+pmt+goal)/60+vc:.2f}; max VC at 60u w/ debt: {price-(fixed+pmt+goal)/60:.2f}")
print(f"price needed at 60u no debt: {(fixed+goal)/60+vc:.2f}")
# loan composition
print("Uses: deposit 1000 + balance machinery 7000 + inventory 2000 + card 2000 = ", 1000+7000+2000+2000)
print("Eligible uses (machinery 8000 + inventory 2000) =", 10000, "; ineligible personal card 2000")
print("If cash $1000 pays deposit, financed need = 7000+2000 =", 9000, f"; payment on 10000 @10%/36 = {10000*r/(1-(1+r)**-n):.2f}; on 9000 = {9000*r/(1-(1+r)**-n):.2f}")
