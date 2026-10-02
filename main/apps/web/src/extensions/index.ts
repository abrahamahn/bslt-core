import { installedFeatures } from './installed';
export const featureRoutes = installedFeatures.map(({ id, Page }) => ({
  path: `extensions/${id}`,
  element: Page,
  protected: true,
}));
export const featureNavigation = installedFeatures.map(({ id, name }) => ({
  to: `/extensions/${id}`,
  label: name,
}));
