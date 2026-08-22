import type { ModelSpec } from '../types';
import { buildModelGroup } from './modelGeometry';

/**
 * Bake a prototype model into a real `.glb` File, ready for the ordinary asset import pipeline
 * (`addAssets`) — the same trick fbxToGlb uses. From there it is a first-class model asset:
 * thumbnailed, placeable, exportable in .nfpack packages, and openable in Blender.
 */
export async function modelSpecToGlbFile(spec: ModelSpec): Promise<File> {
  const { GLTFExporter } = await import('three-stdlib');
  const glb = (await new GLTFExporter().parseAsync(buildModelGroup(spec), { binary: true })) as ArrayBuffer;
  const stem = spec.name.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
  return new File([glb], `${stem}.glb`, { type: 'model/gltf-binary' });
}
