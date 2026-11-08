import { Color, MeshPhysicalMaterial, Vector3 } from 'three';
import { garmentGLSL } from './swimwear';

export const skinTones = ['#d59e80', '#bc8263', '#925a42', '#603b2d'];
export const fabricTones = ['#6a9c8e', '#dd778c', '#e8e7dc', '#303638'];

export function createSkin() {
  const uniforms = {
    uSkin: { value: new Color(skinTones[0]) },
    uFabric: { value: new Color(fabricTones[0]) },
    uContact: { value: new Vector3(10, 10, 10) },
    uFlush: { value: 0 },
  };
  const material = new MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.52, metalness: 0,
    ior: 1.42, specularIntensity: 0.32,
    sheen: 0.08, sheenRoughness: 0.75, sheenColor: new Color('#efb5a4'),
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 restPosition;\nvarying vec3 vAnatomy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAnatomy = restPosition;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying vec3 vAnatomy;
      uniform vec3 uSkin;
      uniform vec3 uFabric;
      uniform vec3 uContact;
      uniform float uFlush;
      float hashSkin(vec3 p) {
        p = fract(p * .1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float skinNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f*f*(3.-2.*f);
        return mix(mix(mix(hashSkin(i), hashSkin(i+vec3(1,0,0)), f.x),
                       mix(hashSkin(i+vec3(0,1,0)), hashSkin(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hashSkin(i+vec3(0,0,1)), hashSkin(i+vec3(1,0,1)), f.x),
                       mix(hashSkin(i+vec3(0,1,1)), hashSkin(i+vec3(1,1,1)), f.x), f.y), f.z);
      }
      ${garmentGLSL}
      float poreHeight(vec3 p) {
        return skinNoise(p * 175.) * .42 + skinNoise(p * 390.) * .17;
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float fabric = garment(vAnatomy);
      float mottling = skinNoise(vAnatomy * 5.0) * .5 + skinNoise(vAnatomy * 18.) * .3 + skinNoise(vAnatomy * 57.) * .2;
      vec3 skin = uSkin * (.94 + mottling * .11);
      float cheek = exp(-pow((abs(vAnatomy.x)-.55)/.48,2.)-pow(vAnatomy.y/.45,2.)) * smoothstep(.12,.6,vAnatomy.z);
      skin *= mix(vec3(1.), vec3(1.035,.95,.955),cheek*.55);
      float freckle = smoothstep(.84,.95,skinNoise(vAnatomy*95.)) * .065;
      skin *= 1.-freckle;
      float flush = exp(-dot(vAnatomy-uContact,vAnatomy-uContact)*15.) * uFlush;
      skin = mix(skin,skin*vec3(1.04,.72,.72),flush*.55);
      float weave = sin(vAnatomy.y*680.)*sin(vAnatomy.x*680.)*.022;
      vec3 cloth = uFabric*(.98+weave);
      float edge = abs(garment(vAnatomy+vec3(0,.012,0))-fabric);
      cloth *= 1.-edge*.17;
      diffuseColor.rgb *= mix(skin,cloth,fabric);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = mix(.49 + skinNoise(vAnatomy * 110.) * .15, .87, garment(vAnatomy));
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec3 dp1 = dFdx(vViewPosition), dp2 = dFdy(vViewPosition);
      vec3 r1 = cross(dp2, normal), r2 = cross(normal, dp1);
      float det = dot(dp1,r1);
      float height = poreHeight(vAnatomy) * .00034;
      vec3 gradient = sign(det) * (dFdx(height)*r1 + dFdy(height)*r2);
      normal = normalize(abs(det)*normal - gradient);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float rim = pow(1.-max(dot(normal,geometryViewDir),0.),3.);
      outgoingLight += uSkin * vec3(.085,.023,.015) * rim * (1.-garment(vAnatomy));
      #include <opaque_fragment>
    `);
  };
  return { material, uniforms };
}
