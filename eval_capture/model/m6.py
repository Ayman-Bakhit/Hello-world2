# Extend glass route to 26 weeks (to ~May 31 2027): pitching 2 days/wk continues; winter skip wks1-13, 5% after.
def run(close, price=25, convos=20, churn=0.012):
    a=0.0; out=[]
    for w in range(1,27):
        start=a; pdays = 3 if w<=4 else 2
        skip = 0.25 if w<=13 else 0.05
        out.append(start*0.5*(1-skip)*price)
        a = start*(1-churn) + pdays*convos*close
    return round(a,1), round(a*price*2.17), round(sum(out))
for c in (0.015,0.03,0.045,0.06,0.10):
    acc, mrr, rev26 = run(c)
    print(f"close {c:.1%}: accounts wk26={acc}, monthly run-rate=${mrr}, 26-wk gross=${rev26}, route hrs/wk at 20min/stop={round(acc*0.5*20/60,1)}")
