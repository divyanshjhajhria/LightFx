// Does netting pay when desks are pushed in opposite directions for a long time?
// `npm run study`. Leased strategy only, netting on vs off, same seeds, no storm, no panic.
import { FLOW, MINUTES, SEEDS, nettingStudy } from './nettingStudy';

console.log(
  `Sustained opposite flow (sell probability Earth ${FLOW.earth}, Moon ${FLOW.moon}, Mars ${FLOW.mars}), ` +
    `${MINUTES} minutes, seeds ${SEEDS[0]} to ${SEEDS[SEEDS.length - 1]}, leased strategy.`,
);
console.table(nettingStudy());
