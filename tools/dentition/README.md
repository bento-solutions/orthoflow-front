# Dentition bake

Turns the source model into the two small files the 3D chart loads. Run it by hand when the source
or the bake changes; it is not part of the app build and its dependencies are its own.

```bash
cd frontend/tools/dentition
npm install
npm run bake
```

It writes `public/3d/dentition/{permanent,primary}.<hash>.glb` and
`src/app/features/dental-3d/dentition-assets.generated.ts`, which points the app at them. The names
carry a hash of the content, so nginx can cache them forever.

## Why a bake

`source/permanent_dentition` is "Permanent Dentition" by the University of Dundee, School of
Dentistry (CC BY 4.0, see its `license.txt`), sculpted in ZBrush from CT data. The geometry is what a
chart wants: 32 separate teeth with their roots, about 60,000 triangles. As downloaded it could not
be shipped:

| | Source | Baked |
|---|---|---|
| Download | 11 MB in 19 files | 517 KB, one file |
| GPU memory | 1.5 GB (17 textures of 4096x4096) | a few MB, no textures |
| Which tooth is which | guessed at runtime from positions | named by FDI code, checked at bake time |
| Where the surfaces are | nothing | every vertex knows its place on the tooth |
| Primary teeth | none | 20, in a second file loaded only for children |

## What it does

- Reads every tooth, drops the source's one stray sliver, and names teeth by position. The source
  has one material per mirrored pair, so the positions are checked against the materials, and the
  bake stops rather than write a model where a number might be on the wrong tooth.
- Samples the texture at each vertex. Enamel is white and root is tan, which gives the real enamel
  line, scalloped as it is on a tooth, and a natural colour with no texture at run time.
- Moves each tooth into its own frame (y occlusal, z buccal), which is what lets the chart
  rearrange teeth by turning each one, and records where it stood in the natural arch.
- Writes `_LOCAL` for each vertex: toward the midline, toward the cheek, height above the enamel
  line, and self-occlusion ray-traced from the mesh, so fissures and furcations read in any
  arrangement. The chart's shader draws surfaces from the first three
  (`zoneAt` in `core/clinical/tooth-paint.ts`).
- Quantises, reorders for the vertex cache, and compresses with meshopt.

## Primary teeth

`primary.*.glb` is derived from the permanent teeth, resized to textbook crown and root dimensions
and with whiter enamel, because no primary model could be downloaded without an account. Each
tooth's shape comes from the permanent tooth closest to it (table in `bake.mjs`). It shows a primary
tooth of the right kind in the right place; it is an illustration and the chart says so.

Real scans exist under CC BY on Sketchfab, downloadable by anyone signed in:

- University of Dundee (the same authors as the permanent model): FDI 61-65 and 71-75. Search
  `user:DundeeDental "Primary"`.
- `AdjacentMoth8215`: FDI 51-55 and 81-85.

To use them, download the glTF of each into `source/primary/` and teach `derivePrimary` to read them
in place of the resized teeth. Each is one tooth, some over 600,000 triangles, so they would also need
decimating to about 2,000 first (`MeshoptSimplifier`, in the same package as the encoder).
