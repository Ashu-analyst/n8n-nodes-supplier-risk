import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { scoreSupplier } from '../../src/riskScore';

export class SupplierRisk implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Supplier Risk Score',
    name: 'supplierRisk',
    icon: 'file:supplierRisk.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{"Score suppliers"}}',
    description: 'Calculates a 0–100 supplier risk score, risk band and approval route',
    defaults: { name: 'Supplier Risk Score' },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Supplier ID Field',
        name: 'supplierIdField',
        type: 'string',
        default: 'supplierId',
        description: 'Name of the input field that holds the supplier ID',
      },
      {
        displayName: 'Country Risk Field',
        name: 'countryField',
        type: 'string',
        default: 'countryRiskIndex',
      },
      {
        displayName: 'Category Field',
        name: 'categoryField',
        type: 'string',
        default: 'category',
      },
      {
        displayName: 'Questionnaire Score Field',
        name: 'saqField',
        type: 'string',
        default: 'saqScore',
      },
      {
        displayName: 'Adverse Media Count Field',
        name: 'mediaField',
        type: 'string',
        default: 'adverseMediaCount',
      },
      {
        displayName: 'Include Score Breakdown',
        name: 'includeBreakdown',
        type: 'boolean',
        default: true,
        description: 'Whether to add the component scores and warnings to the output',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const f = (name: string) => this.getNodeParameter(name, i) as string;
        const json = items[i].json;
        const result = scoreSupplier({
          supplierId: String(json[f('supplierIdField')] ?? ''),
          countryRiskIndex: Number(json[f('countryField')]),
          category: String(json[f('categoryField')] ?? ''),
          saqScore: json[f('saqField')] as number | null | undefined,
          adverseMediaCount: Number(json[f('mediaField')] ?? 0),
        });

        const includeBreakdown = this.getNodeParameter('includeBreakdown', i) as boolean;
        const risk: IDataObject = { score: result.score, band: result.band, route: result.route };
        if (includeBreakdown) {
          risk.components = result.components as unknown as IDataObject;
          risk.warnings = result.warnings;
        }
        out.push({ json: { ...json, risk }, pairedItem: { item: i } });
      } catch (error) {
        // Respect n8n's "Continue On Fail" setting so one bad row doesn't stop a batch.
        if (this.continueOnFail()) {
          out.push({ json: { ...items[i].json, error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }
        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
      }
    }
    return [out];
  }
}
