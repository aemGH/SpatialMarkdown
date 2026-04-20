/**
 * Constraint Solver — Top-down constraint propagation.
 *
 * @module @spatial/engine/constraints
 */

export {
  resolveBlockConstraints,
  resolveStackConstraints,
  resolveGridConstraints,
  resolveColumnsConstraints,
} from './layout-modes';

export type { ConstraintSolver } from './solver';
export { createConstraintSolver } from './solver';
