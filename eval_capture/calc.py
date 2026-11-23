budget=1000
vo=59
print("Virtual office 12mo:",vo*12, f"{vo*12/budget:.0%} of budget")
# outbound stack (12 months)
domain=11      # ESTIMATE .com at-cost, unverified
carrd=19       # verified Pro Standard/yr
ws=8.40        # UNVERIFIED Workspace Business Starter flexible $/mo
year1=domain+carrd+ws*12
print("Outbound stack yr1:",round(year1,2), f"{year1/budget:.0%}")
two_wk=domain+carrd+ws
print("Outbound cash out first 2 wks:",round(two_wk,2))
# scenario pricing (assumptions)
cleanup=400; monthly=300
print("Months of reporting to cover VO yr:",round(vo*12/monthly,2))
print("Cleanup jobs to cover outbound yr1:",round(year1/cleanup,2))
# funnel scenario
sends=150
for r in (0.01,0.03,0.05):
    replies=sends*r
    print(f"reply {r:.0%}: {replies:.1f} replies")
