/** 一条清单违规。`file` 是相对包目录的路径。 */
export interface Finding {
  /** 规则 id，例如 `L2`。 */
  rule: string
  file: string
  message: string
}

/** 一条清单规则。0002 起逐条加入 `rules`。 */
export interface Rule {
  id: string
  check(dir: string): Promise<Finding[]> | Finding[]
}
