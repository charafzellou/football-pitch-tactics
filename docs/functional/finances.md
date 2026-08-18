# Finances

The second half of the job. As **Chairman** you decide where the club's money comes from; as **Director of Football** you decide what it is spent on and how far ahead you are willing to plan.

Five pages under `/game/finance`, and every figure on them traces back to a `finance_ledger` row — so the balance can always be explained rather than merely asserted.

| Page | What you decide |
|---|---|
| Overview | Nothing directly — this is the profit and loss, the wage pressure, and the debt |
| Projection | Nothing directly — this is the four-season forecast and the budgets it recommends |
| Commercial | Which sponsors to sign, on what terms, and whether to sell the ground's name |
| Stadium | Ticket price, season tickets, executive boxes, expansion, and who else uses the ground |
| Facilities | The academy and the training ground |

---

## The one rule to understand first

> **Budgets advise. They never block.**
>
> No endpoint in this game will refuse a signing, a contract, or an upgrade because it exceeds a recommended budget. The wage recommendation and the transfer budget are numbers on a page, and you are free to ignore them.
>
> What bites is the bank balance actually going below zero. That is a fact rather than an opinion, and it escalates — see [When it goes wrong](#when-it-goes-wrong). The advisor's job is to stop you reaching stage 2, not to prevent you trying.

---

## Overview

The season's profit and loss, grouped the way a club would read it.

**Income** falls under Matchday, Commercial, Football and Financing. **Costs** fall under Squad, Running the club, Capital and Financing. Each row shows the total, its share of that side of the account, and a per-matchday figure — because per-matchday is the only cadence this game has, and it is the number that makes a wage bill comparable to a sponsorship deal.

Three headline figures sit above it:

| Figure | Meaning |
|---|---|
| **Turnover** | Income less what it costs to run the club |
| **Season result** | Income less *everything*, including wages and transfers |
| **Projected at season end** | The balance at the current rate — a straight line, and the Projection page is the one that models step changes |

> **Wages are measured against turnover, not income.** Your club is the only one in the league whose running costs are itemised, and its commercial income is grossed up to fund them. Measuring wages against that gross figure would flatter you by about six points relative to every CPU club, and six points is most of the distance to the 85% at which the board starts objecting.

### Borrowing

The debt section sits on this page rather than behind another click, because debt service is the one cost you cannot change your mind about — it belongs next to the balance it is draining.

| Term | Detail |
|---|---|
| How much | Up to 60% of a full season's income, less what you already owe |
| Rate | `4% + (1 − reputation/100) × 6%`, plus **4 more points if you are already overdrawn** |
| Repayment | Straight-line principal every matchday, plus interest, for the whole term |
| Early settlement | Any loan can be paid off in full at any time, if the balance covers it |

> **Money is cheapest to the clubs that least need it.** A big club with cash in the bank borrows at 4%; a small club already in the red borrows at over 12%. This is how a cash-flow problem becomes a solvency problem if you do not fix it, and it is why borrowing to cover a wage bill is a decision rather than a button.

---

## Projection

Four seasons: this one and the three after it. The first covers only the matchdays still to play, because money already spent is in the balance rather than in the forecast.

The chart draws a central line and a band. The band is a ±4-place finishing range, and it **compounds** — three good seasons are further from three bad ones than one is.

What the forecast models that a straight line cannot:

- contracts running out, and what renewing them would cost
- youth intake filling the squad back to 22, at wages
- players retiring — as an *expectation*, so the page gives the same answer twice
- sponsorship deals expiring, and being re-signed at your then-reputation
- loans maturing and debt service falling away
- prize money at the finish you are heading for

> **Retirement is an expectation, not a coin toss.** A 35-year-old with a 40% chance of hanging up his boots carries 60% of his wage into the forecast. A projection that rolled the dice would give a different answer every time you opened the page, which is worse than being slightly wrong in a stable direction.

> **An expiring sponsor is not a cliff.** Slots that lapse inside the horizon are assumed re-sold at the market rate, because a club does re-sell its shirt. Showing the slot as dead would have every manager planning around a hole in season three that never actually arrives.

### Risk flags

| Flag | Raised when |
|---|---|
| Contracts expiring | Anyone is out of contract at the end of a projected season |
| Deal expiring | A sponsorship slot lapses that summer |
| Loan maturing | A loan reaches the end of its term |
| Wage ratio high | Wages pass 75% of turnover (warning) or 85% (the board's threshold) |
| Projected insolvent | A projected closing balance is below zero |

### The budgets

| Figure | How it is worked out |
|---|---|
| **Healthy wage bill** | 60% of turnover per matchday |
| **Wage ceiling** | 75% of turnover per matchday — below the 85% the board punishes |
| **Safe transfer spend** | Projected closing balance, less three matchdays of wages |

The useful one appears in the transfer market and inside the contract modal as the wage slider moves:

> **A signing costs a fee today *and* a wage every matchday until the season ends.** A headline transfer budget overstates what you can actually afford by exactly that second amount. So the market shows both: *"€18.4M available — or €12.1M if he earns €40k a matchday."*

---

## Commercial

Four slots. Three of them your club already has sold at the market rate when the save opens; the fourth is the decision.

| Slot | Worth | Notes |
|---|---|---|
| Shirt sponsor | 38% of commercial income | The big one |
| Kit manufacturer | 22% | |
| Sleeve sponsor | 9% | |
| **Stadium naming rights** | +12% on top | Unsold at the start. Costs 9 fan confidence the first time you sell it |

> **A club is never between every sponsor at once.** Starting with everything unsold would have been the tidier model and is wrong twice over — and you would have spent your first season earning back income the game had quietly taken off you. Naming rights are left unsold because that one *is* a decision: it is the slot with something to lose.

### Offers

Each open slot draws three competing offers. They **persist** — the same offers are there when you come back, and they lapse after four matchdays. An offer that rerolled every time you opened the page would be noise, not a decision.

| Shape | Term | Fee | Bonuses |
|---|---|---|---|
| Long term | 5 seasons | 6% below market | Smallest |
| Standard | 3 seasons | Market rate | Middling |
| Short and rich | 1 season | 6% above market | Largest |

The fee moves on exactly the same curve a player's wage does when you offer him another year — 3% off the rate per season committed. A sponsor and a centre-half are being asked the same question, so they are priced the same way.

Bonuses pay at the season rollover, next to prize money, for winning the league, finishing top four, or surviving. **A deal in its final season is paid its bonus before it is retired** — which is what makes the short deal's larger bonus worth taking.

How supporters feel moves what sponsors will pay, by up to a third between a miserable club and a delighted one. Results and the ticket price reach the commercial department without another dial.

> **An empty slot earns nothing.** That is the entire consequence of letting a deal lapse, and the reason the offers are worth answering.

### Perimeter advertising

A capital ladder: static hoardings → LED → premium LED → full-wrap digital, worth ×1 through ×2.4. Each upgrade is priced to pay itself back in about 2.2 seasons **for any club** — the cost scales with your commercial income, so a giant and a small club face the same decision on the same terms.

---

## Stadium

### Ticket price

Unchanged from before: too high and seats stay empty and the board notices; too low and you are giving money away.

### Season tickets

Sell up to 45% of the ground in advance, at up to 35% off.

> **Cash now, upside later.** Holders turn up whatever happens, so they are a floor under the crowd — and they paid in the summer, so they are a hole in the gate for the whole season. A chairman short of money in July can sell certainty and spend it, and then watch a title run fill a ground he has already been paid for.

### Executive boxes

€300,000 each. A box takes 12 general seats out of the ground and earns about fourteen times what those seats would have made.

Boxes are the one seat in the ground that does not care what the ticket price is — they are how you de-risk gate income, bought with capital and with the seats they replace.

### Other people's events

Promoters approach about weeks you are not playing at home. The fee and the damage move together:

| Offer | Pays | Pitch | Supporters |
|---|---|---|---|
| Stadium concert | Best cheque anyone will write | −22 | Indifferent |
| International fixture | Good | −14 | Pleased |
| Rugby match | Fair | −18 | Unimpressed |
| Corporate conference | Little | Untouched | Indifferent |
| Community day | Almost nothing | Untouched | Delighted |

> **A worn pitch costs your side up to 2.5 on attack and defence, and nobody else.** It is your ground and your decision — the money from the concert is yours, so the rutted goalmouth is too. The pitch recovers 9 points a matchday and never falls below 25, so the penalty is comparable to a formation choice: enough to feel, never enough to decide a match on its own.
>
> **The injuries are not yours alone.** A cut-up surface raises the injury rate by up to half for *both* sides, because a goalmouth does not know who booked the concert. It is worth about one extra injury every nine matches at the worst — you will not notice it in a fixture, and you will notice it over a spring of hiring the ground out.

The pitch is relaid over the summer, so nothing you do in April follows you into the next season.

Anything that touches the pitch asks for confirmation first, showing the fee, the damage, and what it will cost the team. A conference does not ask, because it costs nothing.

---

## Facilities

The Director of Football's two long bets, both 0–3, both with permanent upkeep.

| | What it changes | When you see it |
|---|---|---|
| **Academy** | Graduates arrive with more ability and, mostly, a much higher ceiling. At the top level it produces one graduate a summer beyond what the squad needs | Next summer at the earliest; properly, three summers on |
| **Training ground** | Players develop faster, decline slower, recover more stamina between matches, and sometimes come back early from injury | Stamina immediately; everything else over seasons |

> **Neither of these pays back this season, and the page says so.** An academy graduate is sixteen. A training ground is worth a point or two a player a year. The only place these decisions can be judged is the four-season projection — which is precisely why the projection had to exist before facilities did.

Upgrades cost more for a bigger club and are worth more to one, because both are priced off commercial income.

---

## When it goes wrong

Going overdrawn is not a soft fail.

| Stage | Reached when | What happens |
|---|---|---|
| **Overdrawn** | The balance goes below zero | You start paying 12% a year in overdraft interest, every matchday |
| **Transfer embargo** | Three consecutive matchdays overdrawn | You cannot buy, cannot sign a free agent, and cannot improve a contract. Supporters turn. **You can still sell** — that is how you get out |
| **Board intervention** | Eight matchdays overdrawn, or worse than −€15M | The board sells your most valuable player, at a fifth under his valuation, without consulting you. It will do it again every matchday until you are solvent |

Recovering takes time on purpose: each solvent matchday steps the stage down by one, so climbing out of a board intervention takes three matchdays in the black. A one-off windfall cannot cancel a crisis half a season in the making.

> **The board will not sell you into a squad you cannot field.** Below sixteen contracted players it stops and complains instead. That is a real outcome, and it is the worst one in the game: a club can be too broke to be saved by selling.

Underneath all of this, the board's ordinary confidence meter has always docked you for a negative balance — so sustained insolvency also feeds the confidence streak, and the sack.

---

## What this does not do

| | |
|---|---|
| CPU clubs have no ventures | No deals, events, boxes or debt. Their commercial income is calibrated to match yours exactly, so nobody is ahead — but a CPU club can never overreach financially either |
| Nothing happens between matchdays | Events, upgrades and drawdowns all settle on a round, because a matchday is the only clock this game has |
| The forecast assumes the squad you have | It ages and renews it, but it will never model a signing you have not made |
