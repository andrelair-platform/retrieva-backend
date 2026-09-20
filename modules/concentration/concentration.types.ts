// Domain response types for the concentration module (DORA nth-party graph, RTV-15).
// These describe the shapes the controller returns; the service layer
// (services/concentrationService.js) remains shared/.js for now.

export interface ProviderConcentration {
  providerId: string;
  providerName: string;
  workspaceCount: number;
  criticalFunctionCount: number;
  isSpof: boolean;
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'entity' | 'provider' | 'sub-provider' | 'function';
}

export interface GraphEdge {
  source: string;
  target: string;
  confirmed: boolean;
}

export interface ConcentrationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
