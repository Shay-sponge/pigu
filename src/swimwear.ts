import { BufferGeometry, MathUtils, MeshPhysicalMaterial, type Color } from 'three';

// One cut definition is shared by skin coverage and the raised fabric shell.
export const garmentGLSL = `
  float garmentDistance(vec3 p) {
    float side = clamp(abs(p.x)/1.16,0.,1.);
    float waist = .91 + .13*pow(side,1.7);
    float back = smoothstep(-.65,-.35,p.z);
    float bottom = mix(-.58+1.48*pow(side,1.55), -.10+1.15*pow(side,1.3), back);
    return min(p.y-bottom,waist-p.y);
  }
  float garment(vec3 p) { return smoothstep(-.003,.003,garmentDistance(p)); }
`;

function distance(x: number, y: number, z: number) {
  const side = MathUtils.clamp(Math.abs(x) / 1.16, 0, 1);
  const waist = 0.91 + 0.13 * side ** 1.7;
  const bottom = MathUtils.lerp(-0.58 + 1.48 * side ** 1.55, -0.10 + 1.15 * side ** 1.3, MathUtils.smoothstep(z, -0.65, -0.35));
  return Math.min(y - bottom, waist - y);
}

export function createSwimwear(body: BufferGeometry, color: { value: Color }) {
  const geometry = new BufferGeometry();
  // Share the live attributes: the cloth follows exactly the same tissue
  // displacement, with no second physics solve or delayed frame of movement.
  for (const key of ['position', 'normal', 'restPosition']) geometry.setAttribute(key, body.attributes[key]);
  const p = body.attributes.restPosition, index = body.index!, indices: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    if (triangle.some(j => distance(p.getX(j), p.getY(j), p.getZ(j)) > -0.07)) indices.push(...triangle);
  }
  geometry.setIndex(indices);
  geometry.boundingSphere = body.boundingSphere?.clone() ?? null;
  const material = new MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.82, metalness: 0, sheen: 0.22, sheenRoughness: 0.85,
    specularIntensity: 0.2,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uFabric = color;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 restPosition;\nvarying vec3 vCloth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth = restPosition;\ntransformed += objectNormal * .008;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCloth;\nuniform vec3 uFabric;\n${garmentGLSL}`)
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        float edgeDistance = garmentDistance(vCloth);
        if(edgeDistance < 0.) discard;
        float binding = 1.-smoothstep(.013,.024,edgeDistance);
        float stitch = (1.-smoothstep(.0015,.0035,abs(edgeDistance-.026)))
          * smoothstep(-.3,.2,sin((vCloth.x+vCloth.y*.55)*390.));
        float weave = sin(vCloth.x*730.)*sin(vCloth.y*650.);
        diffuseColor.rgb *= uFabric * (1. + weave*.017 - binding*.20 + stitch*.18);
      `);
  };
  return { geometry, material };
}
