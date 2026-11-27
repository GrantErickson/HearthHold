import * as THREE from 'three';

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 260);
export const engine = {
  renderer: null as THREE.WebGLRenderer | null,
  w: 1,
  h: 1,
};
