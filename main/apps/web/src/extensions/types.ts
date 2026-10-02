import type { ComponentType } from 'react';
export interface InstalledWebFeature {
  id: string;
  name: string;
  Page: ComponentType;
}
