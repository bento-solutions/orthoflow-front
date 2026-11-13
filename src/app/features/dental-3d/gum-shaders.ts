/**
 * How the gums and the palate are drawn (gum-geometry.ts has what a vertex knows about its place).
 *
 * What each tooth's gum shows comes from a small texture, three texels of twelve effects a slot, read
 * in the vertex shader (the margin withdraws, the gum swells, an abscess bulges) and in the fragment
 * shader (the colour of inflammation, the beads of pus, the patches of pigment). A state changing is
 * an upload of a few hundred bytes: no geometry is rebuilt.
 *
 * Between two teeth the effects of the two blend, so a papilla belongs to both.
 *
 * Effects, in the order of the texels (each 0 to 1):
 *   texel 0: inflamed, swollen, recession, pocket
 *   texel 1: perio, bleeding, pus, ulcer
 *   texel 2: pigment, abscess, lesion, pale
 */

export const GUM_VERTEX = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform mat3 normalMatrix;
  uniform float uRecession;
  uniform highp sampler2D uGum;
  in vec3 position;
  in vec3 normal;
  in vec4 _g;
  in vec3 _axis;
  out vec3 vViewPosition;
  out vec3 vNormal;
  out vec3 vObject;
  out vec4 vG;
  out vec4 vA;
  out vec4 vB;
  out vec4 vC;

  const float PI = 3.14159265;

  void effects(float slot, out vec4 a, out vec4 b, out vec4 c) {
    int s = int(slot + 0.5);
    a = texelFetch(uGum, ivec2(0, s), 0);
    b = texelFetch(uGum, ivec2(1, s), 0);
    c = texelFetch(uGum, ivec2(2, s), 0);
  }

  void main() {
    float tooth = floor(_g.x);
    float along = _g.x - tooth;
    vec4 a0; vec4 b0; vec4 c0; vec4 a1; vec4 b1; vec4 c1;
    effects(tooth, a0, b0, c0);
    effects(tooth + 1.0, a1, b1, c1);
    // The papilla between two teeth belongs to both.
    float toNext = smoothstep(0.3, 0.7, along);
    vA = mix(a0, a1, toNext);
    vB = mix(b0, b1, toNext);
    vC = mix(c0, c1, toNext);

    float band = _g.y;
    // The ridge only: the palate and the caps at the ends of the arch stay as they are.
    float ridge = 1.0 - step(0.5, _g.w);
    float papilla = (1.0 - cos(2.0 * PI * _g.x)) * 0.5;
    float nearMargin = 1.0 - band;

    vec3 p = position;
    // The margin withdraws toward the roots, less the further from it: the root is bared.
    p -= _axis * vA.z * uRecession * pow(nearMargin, 2.0) * ridge;
    // Swollen: thicker round the neck, and the papillae rise.
    p += normal * vA.y * 0.03 * pow(nearMargin, 1.4) * ridge;
    p += _axis * vA.y * 0.045 * papilla * pow(nearMargin, 2.0) * ridge;
    // An abscess is a bump on the cheek side, over the root.
    float across = fract(_g.x + 0.5) - 0.5;
    float cheek = step(0.5, _g.z) * (1.0 - step(1.5, _g.z));
    float bump = vC.y * exp(-(across * across) / 0.05 - pow(band - 0.45, 2.0) / 0.04) * cheek * ridge;
    p += normal * bump * 0.07;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPosition = mv.xyz;
    vNormal = normalMatrix * normal;
    vObject = p;
    vG = _g;
    gl_Position = projectionMatrix * mv;
  }
`;

export const GUM_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uFade;
  uniform float uSeeThrough;
  uniform float uHoverSlot;
  uniform float uSelectedSlot;
  in vec3 vViewPosition;
  in vec3 vNormal;
  in vec3 vObject;
  in vec4 vG;
  in vec4 vA;
  in vec4 vB;
  in vec4 vC;
  out vec4 fragColor;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  void main() {
    float band = vG.y;
    bool palate = vG.w > 0.5 && vG.w < 1.5;
    float inflamed = vA.x;
    float swollen = vA.y;
    float pocket = vA.w;
    float perio = vB.x;
    float bleeding = vB.y;
    float pus = vB.z;
    float ulcer = vB.w;
    float pigment = vC.x;
    float abscess = vC.y;
    float lesion = vC.z;
    float pale = vC.w;

    vec3 N = normalize(vNormal);
    vec3 V = normalize(-vViewPosition);
    if (!gl_FrontFacing) N = -N;

    float nearMargin = 1.0 - smoothstep(0.0, 0.22, band);
    float across = fract(vG.x + 0.5) - 0.5;

    // Healthy tissue: pink, finely stippled, a little pinker at the rolled margin.
    vec3 base = vec3(0.90, 0.57, 0.56);
    base *= 0.965 + 0.07 * vnoise(vObject * 170.0);
    base = mix(base, vec3(0.96, 0.64, 0.61), 0.34 * nearMargin);

    if (palate) {
      // The vault: darker where it leaves the ridge, paler at the middle, with the transverse ridges of the front.
      base = mix(vec3(0.86, 0.50, 0.49), vec3(0.94, 0.66, 0.62), band);
      float rugae = smoothstep(0.55, 0.95, sin(band * 30.0 + 2.5 * sin(vG.x * 1.9)));
      base *= 1.0 - 0.07 * rugae * (1.0 - smoothstep(0.2, 0.75, band));
    }

    // What was found.
    base = mix(base, vec3(0.80, 0.13, 0.17), clamp(inflamed, 0.0, 1.0) * (0.42 + 0.5 * nearMargin));
    base = mix(base, vec3(0.52, 0.10, 0.30), clamp(perio, 0.0, 1.0) * (0.34 + 0.5 * nearMargin) * 0.85);
    base = mix(base, vec3(0.97, 0.80, 0.76), pale * (1.0 - nearMargin) * 0.8);
    // A pocket: the margin lined dark where the gum has come away from the tooth.
    base = mix(base, vec3(0.36, 0.07, 0.10), pocket * (1.0 - smoothstep(0.0, 0.07, band)));
    // Pigment: brown patches.
    float blotch = smoothstep(0.52, 0.66, vnoise(vObject * 28.0 + 7.0));
    base = mix(base, vec3(0.30, 0.17, 0.14), pigment * blotch * 0.85);
    // A lesion: an irregular patch, white where the surface is broken, red round it.
    float lesionPatch = smoothstep(0.55, 0.68, vnoise(vObject * 22.0 + 3.0));
    base = mix(base, mix(vec3(0.95, 0.90, 0.88), vec3(0.74, 0.16, 0.22), step(0.5, vnoise(vObject * 40.0))), lesion * lesionPatch * 0.9);
    // An ulcer: a pale crater with a red halo, near the margin, on the middle of the tooth.
    float crater = length(vec2(across * 1.6, (band - 0.14) * 2.2));
    base = mix(base, vec3(0.74, 0.13, 0.15), ulcer * (1.0 - smoothstep(0.22, 0.42, crater)) * 0.9);
    base = mix(base, vec3(0.96, 0.93, 0.80), ulcer * (1.0 - smoothstep(0.12, 0.22, crater)));
    // Bleeding: dark red drops from the margin. Pus: yellow beads on it.
    float drops = step(0.962, vnoise(vObject * 120.0)) * (1.0 - smoothstep(0.0, 0.5, band));
    base = mix(base, vec3(0.62, 0.02, 0.05), bleeding * drops);
    float beads = step(0.93, vnoise(vObject * 90.0 + 11.0)) * (1.0 - smoothstep(0.0, 0.35, band));
    base = mix(base, vec3(0.98, 0.93, 0.62), pus * beads);
    // An abscess has a yellow-white head on its bump.
    float head = exp(-(across * across) / 0.012 - pow(band - 0.45, 2.0) / 0.008);
    base = mix(base, vec3(0.98, 0.92, 0.60), abscess * head * step(0.5, vG.z) * (1.0 - step(1.5, vG.z)));

    // The gum of the tooth in hand, or pointed at.
    float slot = floor(vG.x + 0.5);
    if (abs(slot - uHoverSlot) < 0.5) base = mix(base, vec3(0.20, 0.55, 0.62), 0.22);
    if (abs(slot - uSelectedSlot) < 0.5) base = mix(base, vec3(0.13, 0.40, 0.48), 0.34);

    // The same light as the teeth.
    vec3 keyDir = normalize(vec3(0.32, 0.5, 0.8));
    vec3 fillDir = normalize(vec3(-0.65, -0.15, 0.55));
    float key = max(dot(N, keyDir), 0.0);
    float fill = max(dot(N, fillDir), 0.0);
    float hemi = 0.5 + 0.5 * N.y;
    vec3 lit = base * (0.5 + 0.12 * hemi + 0.40 * key + 0.12 * fill);
    vec3 H = normalize(keyDir + V);
    // Gum is wet: a soft sheen, more where it is swollen or inflamed.
    lit += (0.10 + 0.28 * swollen + 0.12 * inflamed) * pow(max(dot(N, H), 0.0), 22.0);
    float edge = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    lit *= 1.0 - 0.22 * edge;

    // Over the roots the gum lets them show through: what is in a root (a canal filling, a post,
    // a resorption, a lesion) is the state of the root, and the gum must not hide it.
    float overRoots = smoothstep(0.10, 0.34, band) * (1.0 - smoothstep(0.82, 1.0, band));
    float alpha = palate ? 1.0 : mix(1.0, 0.5, overRoots * uSeeThrough);
    // The far edge of the palate carries on into the throat, so it is not cut off.
    if (vG.z > 2.5) alpha *= smoothstep(0.0, 0.55, band);
    fragColor = vec4(lit, alpha * uFade);
  }
`;
