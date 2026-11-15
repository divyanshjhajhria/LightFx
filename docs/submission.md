# Lightspeed FX

## What it is

Lightspeed FX is one bank with currency desks on Earth, the Moon and Mars, where messages travel at the speed of light
and a solar storm can cut every link for hours. It runs three ways of keeping the bank inside its risk limit, side by
side on identical events. Ours gives every desk its own allowance, so no desk ever has to ask before it trades.

## Why we built it

Every trading firm acts on information that is a little old. Put the offices 20.3 minutes apart and let the line go
dead, and the usual answers fail: a desk that trusts old news can overrun the limit, and a desk that asks head office
cannot trade at all. We wanted to show a third way, honestly, with its cost.

## What it does

Shows desks, messages in flight, failing links, storms and panics. Place a trade and follow it through all three
banks; watch a guided demo of about a minute and a half; rank the banks at a glance; explore a map of thousands of
storms.

## How it works

**The allowance.** The limit is 100 either way, split between the desks (Earth 40, the Moon 20, Mars 40). A desk only
trades inside its own share, and the shares add up to the limit, so the bank cannot pass it whatever is lost or late.
Spare allowance moves through a counter that only goes up, so a lost or repeated message never creates any. A desk
that hears nothing for 60 minutes plays safe.

**Netting.** A desk holding short takes long position off a desk holding long; both get room back.

**The two rival banks.** One checks the limit against the last totals it heard. The other sends every trade to head
office on Earth for approval.

**The agents and the guard.** Each of our desks can be run by its own language-model agent that sees only what its
desk knows, decides its pricing, caution and allowance, and sends notes at light speed. Its answer passes through a
guard that clamps every field, so no answer can break the limit; a test throws hostile answers at it to prove it.

A real model, Claude Haiku 5.5, ran our three desks through the guided demo and two storms: 123 calls, a typical
answer in 3.1 seconds (4.8 seconds for the slowest one in twenty), 120 decisions applied, and the bank never past its
limit (0.93 of it at most). Total cost: $0.0563. The models do get things wrong, and the guard and checks catch it:
one asked to give away allowance it could not spare and the guard gave nothing, 31 notes failed our truth check and
were not sent (208 were), and 2 replies came back cut off and the scripted stand-in decided instead. A recording of
the guided demo, with the model's 39 decisions, replays with no key and no network.

Prices are simulated.

## What we measured

144 combinations of market, distance and storm length, 40 storms each: 5,040 storms, 23.8 million simulation steps.

- Our bank went over its limit in 0 of them; at worst it reached 1.0 times the limit, never past it.
- The bank that trusts old news went over in 39.1% of them (88.7% of panics), at worst 2.7 times the limit.
- The bank that asks Earth never went over, but its Mars office served 0.0 customers per storm while cut off. Ours
  served 19.7.

**What does not flatter us.** Our bank served 58.5% of customers; the bank that trusts old news served 73.9%. Most of
that gap is our pricing, not our safety: the limit cost us 5.3% of customers, while 36.3% walked away at our price
against 23.1% at theirs, because our desks widen their prices when their news is old. On customers we beat the bank
that asks Earth (44.7%), not the reckless one. On money we did better than both: $0.36 a storm on average, against a
loss of $0.29 for the bank that trusts old news and $0.01 for the bank that asks Earth. In a panic our bank lost money
too, $0.20 a storm on average.

Netting raised the volume our bank traded under steady opposite flow by 12.02% with Mars close and 8.24% on the far
side, in 30/30 runs each, never over the limit.

## How we built it

TypeScript, React and a canvas, on a seeded simulation so every bank faces the same customers, prices and storms. 325
automated tests, including property tests that fail if any storm, failure or answer pushes our bank past its limit.
The survival map is a headless sweep of the same simulation.

## What was hard

A fair comparison on identical events; captions that wait until they are true; and a survival map that shows our
losses too.

## What we would do next

Fewer notes failing our truth check, through a better prompt; let allowance follow the flow of customers, where working together pays most.

## The challenges

**Neptune North: systems working together when communications are interrupted.** A common goal: the three desks run
one bank between them, and together serve as many customers as they can without the bank as a whole ever holding more
than its limit, though no desk can see what the others hold now. They cooperate by sharing spare allowance, cancelling
opposite positions and telling each other what they hold, and we measured what that is worth: on the same 540 runs,
our bank served 58.70% of customers with its desks working together and 57.76% with each on its own, more in 384 of
540. The gain is small overall (0.94 points) and clearest when customers all push one way (2.28 points, more in 174
of 180). Independent decisions: each desk trades on its own allowance, never waiting for permission.
Progress when communications fail: cut off by the storm, our Mars desk kept trading, 19.7 customers per storm on
average, where head office's Mars office served 0.0. Something we are excited about: the agents, each deciding for its own desk at
light speed, unable to break the bank because of the guard.

**SGX FX, challenge 1 (protect traders in a market storm) and challenge 2 (a playful way to learn trading).** In a
panic the bank that trusts old news went over its limit in 88.7% of storms; ours in 0. For learning, the guided demo
and "Place a trade" let anyone sell five Mars credits and watch, step by step and in plain words, what each bank does
with the order.

**Marshall Wace: "New Worlds".** Trading between planets, where the speed of light is the fastest anything can
happen, and a storm can leave a desk alone for hours.
