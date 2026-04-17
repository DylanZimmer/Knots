from collections import defaultdict


pd_code = [[1,5,2,4],[3,1,4,6],[5,3,6,2]]

counts = defaultdict(int)
next_label = max(max(crossing) for crossing in pd_code)

mod_pd = []

for crossing in pd_code:
    new_crossing = []
    for x in crossing:
        counts[x] += 1
        if counts[x] == 1:
            new_crossing.append(x)
        else:
            new_crossing.append(next_label + x)
    mod_pd.append(new_crossing)

print(mod_pd)