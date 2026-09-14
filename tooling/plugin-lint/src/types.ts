/** One manifest violation. `file` is a path relative to the package directory. */
export interface Finding {
  /** Rule id, e.g. `L2`. */
  rule: string
  file: string
  message: string
}

/** One manifest rule. Rules join `rules` one at a time. */
export interface Rule {
  id: string
  check(dir: string): Promise<Finding[]> | Finding[]
}
