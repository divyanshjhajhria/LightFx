# The pitch: three minutes

Every figure here is copied from docs/facts.md. Times are approximate: the guided demo runs about a minute and a half
with its voice-over, and waits for you at each step.

## The goal, in one breath

"Our three desks run one bank between them: together they serve as many customers as they can, without the bank as a
whole ever holding more than its limit, and none of them can see what the others hold right now. They work together in
three ways: they share spare allowance, they cancel out opposite positions, and they tell each other what they hold."

## Openers by sponsor

Each takes under 25 seconds, before pressing G. Use one, in place of the general opening below.

**Neptune North.** "Three trading desks, on Earth, the Moon and Mars, share one goal: serve every customer they
safely can without their bank passing its limit. They cooperate by sharing spare allowance, cancelling opposite
positions and telling each other what they hold. When a storm cuts the links, each acts alone. You will see every
desk cut off."

**Marshall Wace ("New Worlds").** "Banking between planets cannot exist yet, so we built it and ran 5,040 storms
through it. A bank that trusts old news mostly gets away with it in a calm market: over its limit in 11.7% of storms.
In a panic, 88.7%. Ours: 0."

**SGX FX, challenge 2 (learning to trade).** "The best way to learn trading is to trade. In a moment you will sell
five Mars credits yourself, then watch, step by step and in plain words, what your order sets off at three different
banks as a solar storm and a market panic hit."

**SGX FX, challenge 1 (protecting traders in a storm).** "A trader's limit has to hold when the market panics and the
lines go down. This bank's limit held in every one of 5,040 simulated storms; a rival that trusts old news went over
in 39.1% of them. Watch it happen."

## Back on Earth, in every version

Say once, in the close: "The same problem exists wherever parts of one system must share a limit without a reliable
link: a bank's regional desks, payments that must work offline, fleets of drones or satellites."

## 0:00 to 0:20, before pressing G

"A bank with trading desks on Earth, the Moon and Mars. With Mars on the far side a message between them takes 20.3
minutes, and a solar storm can cut every link for hours. The bank must never hold more than 100 in either direction. Three banks
are about to face the same storm. Watch which one breaks."

Press **G**.

## 0:20 to about 1:50, the guided demo

The captions and the voice carry it. Say no more than this, and only once the voice has finished:

1. **Place a trade.** Press Space. (Nothing to add.)
2. **Your trade.** "Mars said yes on its own. No permission needed."
3. **Solar storm.** "Every link is gone."
4. **An hour of silence.** "Our Mars desk plays safe by itself."
5. **Market panic.** Point at the Overview: "There. The bank that trusts old news is past its limit."
6. **Total isolation.** "No links at all, and ours still holds."
7. **The storm passes.** (Nothing to add; let the results card speak.)

## About 1:50 to 2:20, the close

"We ran 5,040 storms like that one. Our bank went over its limit 0 times. The bank that trusts old news went over in
39.1% of them. That safety has a price, and we will not hide it: we served 58.5% of customers, and the reckless bank
served 73.9%, because it says yes when it should not. But when the line goes dead, ours keeps trading; the bank that
asks Earth simply stops. The same problem exists wherever parts of one system must share a limit without a reliable
link: a bank's regional desks, payments that must work offline, fleets of drones or satellites."

## 2:20, to questions

"That is Lightspeed FX: every desk free to act, and the bank still safe. We would love your questions."

## Questions we expect

1. **What do you give up?** Customers: our bank served 58.5% of them across the survival map, against 73.9% for the
   bank that trusts old news. We refuse the trades that would take the bank past its limit; it accepts them and goes
   over in 39.1% of storms.

2. **Is this a real multi-agent LLM system?**
   [IF A REAL MODEL SESSION HAS BEEN RECORDED]
   Yes: in our recorded session three language-model agents ran our desks, making `agents.session.decisions`
   decisions (the figure from docs/facts.md). Each sees only its own desk and talks to the others by notes that travel
   at light speed and can be lost.
   [/IF]
   [IF NOT]
   The desks can be run by language-model agents behind a guard, each seeing only its own desk and sending notes at
   light speed. So far we have exercised that path with a scripted stand-in and with random and hostile inputs, not
   with a live model.
   [/IF]

3. **What stops a model breaking the limit?** Its answer reaches the bank only through a guard that clamps every field:
   it can give away only spare allowance, through a counter that only goes up. A property test fires random and hostile
   answers at all three desks during random storms, and the bank never passes its limit.

4. **Why not just use consensus?** Consensus needs a majority to hear each other, and in a storm nobody can hear anyone.
   Mars alone could never reach a quorum, so it would stop trading, exactly like the bank that asks Earth.

5. **Is the data real?** Prices are simulated. The light delays come from the planets' positions in our model: 4.4
   minutes at close approach and 20.3 on the far side.

6. **What happens to a customer mid-storm?** At our bank a desk with room says yes straight away; after 60 minutes out
   of touch it only takes trades that lower its risk. At the bank that asks Earth, the order is lost on the way, and in
   our scripted demo run the visitor reads: "Your order never reached head office, and you left after an hour."

7. **How is this different from a distributed database's counters?** It is the same idea underneath: each desk's grants
   are a counter that only grows, merged by taking the larger value, so lost or repeated messages are harmless. What we
   add is what sits on top: the counters share out a risk limit so that safety needs no communication at all, with
   netting and agents working inside it.

8. **Why move allowance at all?** A fixed split is safe too, but a desk whose customers all sell runs out while another
   sits idle. Moving spare allowance when desks can talk, and netting opposite positions, lets more customers trade:
   netting alone raised volume by 12.02% with Mars close, in 30/30 runs.

9. **How do you know it holds?** 294 automated tests, including property tests that try random storms, cuts, trades and
   hostile agent answers. And the survival map: 5,040 storms, 23.8 million simulation steps, 0 breaches for our bank.

10. **What happens when the storm ends?** The desks catch up: positions, allowance and notes flow again. Earth finally
    hears about your trade, which the demo shows in its last step.

11. **What exactly is the shared goal?** The three desks run one bank: together they serve as many customers as they
    can without the bank as a whole ever holding more than its limit, though none can see what the others hold now.
    It is one score for all three: a customer served by the Moon counts exactly as much as one served by Mars.

12. **How do you know they cooperate and are not just running side by side?** We ran our bank twice on the same 540
    runs, once with its desks sharing allowance and cancelling positions and once with each desk on its own: working
    together served 58.70% of customers against 57.76%, more in 384 of 540. That shows the cooperation is real and
    measurable but small overall, 0.94 points, and that it pays mostly when customers all push one way (2.28 points,
    more in 174 of 180); it does not make the bank safe, which the allowances do on their own.

13. **Why should one desk give up allowance to another?** Because they share one score: a customer served by another
    desk counts as much as one served by you, and allowance sitting idle at one desk can serve a customer at a desk
    that has run out. A desk only ever gives spare allowance, never what its own position needs, so giving can never
    put it, or the bank, at risk.
