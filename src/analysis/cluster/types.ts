// Types for the clustering / grouping layer.

export type ClusterCriterionId =
  | 'identity' // pairwise %-identity (distance-based)
  | 'length'
  | 'hydrophobicity'
  | 'pI'
  | 'composition'
  | 'lifeDomain' // categorical — cannot combine with numeric criteria

export type ClusterMethodId =
  | 'hierarchic' // average-linkage agglomeration, inertia-loss cut (Secator-style)
  | 'kmeans'
  | 'dpc' // density peaks
  | 'mixtureAIC' // Gaussian mixture, k chosen by AIC
  | 'mixtureBIC' // Gaussian mixture, k chosen by BIC

export interface ClusterCriterionInfo {
  id: ClusterCriterionId
  label: string
  /** Distance-based (identity) vs. feature-vector vs. categorical. */
  kind: 'distance' | 'vector' | 'categorical'
}

export const CRITERIA: ClusterCriterionInfo[] = [
  { id: 'identity', label: 'Identity %', kind: 'distance' },
  { id: 'length', label: 'Length', kind: 'vector' },
  { id: 'hydrophobicity', label: 'Hydrophobicity', kind: 'vector' },
  { id: 'pI', label: 'Isoelectric point', kind: 'vector' },
  { id: 'composition', label: 'AA composition', kind: 'vector' },
  { id: 'lifeDomain', label: 'Life domain', kind: 'categorical' },
]

export interface ClusterMethodInfo {
  id: ClusterMethodId
  label: string
  /** Whether the method consumes a distance matrix or feature vectors. */
  input: 'distance' | 'vector'
}

export const CLUSTER_METHODS: ClusterMethodInfo[] = [
  { id: 'hierarchic', label: 'Hierarchic / Secator', input: 'distance' },
  { id: 'kmeans', label: 'K-means', input: 'vector' },
  { id: 'dpc', label: 'Density peaks (DPC)', input: 'distance' },
  { id: 'mixtureAIC', label: 'Mixture model / AIC', input: 'vector' },
  { id: 'mixtureBIC', label: 'Mixture model / BIC', input: 'vector' },
]

/** One cluster: a named, colored set of sequences (by stable row id). */
export interface Cluster {
  id: number
  name: string
  color: string
  members: number[] // AlignmentStore row ids
}

/** A clustering result attached to a snapshot. */
export interface Clustering {
  method: ClusterMethodId
  criteria: ClusterCriterionId[]
  /** Column zones used (empty = whole alignment). */
  zones: [number, number][]
  clusters: Cluster[]
}

/** Serializable per-snapshot group state (rides the snapshot via GroupModel). */
export interface GroupState {
  clustering: Clustering | null
}
