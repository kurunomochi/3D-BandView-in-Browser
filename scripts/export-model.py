"""Executed by Blender inside the isolated conversion directory."""
import bpy

bpy.ops.wm.open_mainfile(filepath='/job/source.blend', load_ui=False, use_scripts=False)
if bpy.data.libraries:
    raise RuntimeError('Linked libraries must be made local before uploading')
# External paths are unavailable inside the sandbox. Require packed textures.
for image in bpy.data.images:
    if image.source == 'FILE' and not image.packed_file:
        raise RuntimeError('Pack external textures into the blend file before uploading')
if not any(obj.type == 'MESH' and obj.visible_get() for obj in bpy.context.scene.objects):
    raise RuntimeError('No visible mesh in the active scene')
bpy.ops.export_scene.gltf(
    filepath='/job/model.glb', export_format='GLB',
    use_visible=True, export_apply=True, export_animations=False,
    export_cameras=False, export_lights=False,
)
print('MODEL_EXPORT_OK', flush=True)
