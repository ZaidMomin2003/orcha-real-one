'use client';

// FIX: Imported `React` to make the React namespace available for types like `React.CSSProperties`.
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { fs as backdropFS, vs as backdropVS } from '@/lib/shaders/backdrop';
import { vs as sphereVS } from '@/lib/shaders/sphere';
import { Analyser } from '@/lib/analyser';

interface Visualizer3DProps {
  inputNode: AudioNode;
  outputNode: AudioNode;
}

export default function Visualizer3D({ inputNode, outputNode }: Visualizer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !inputNode || !outputNode) return;

    const canvas = canvasRef.current;
    let animationFrameId: number;

    const inputAnalyser = new Analyser(inputNode);
    const outputAnalyser = new Analyser(outputNode);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100c14);

    const backdrop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(10, 5),
      new THREE.RawShaderMaterial({
        uniforms: {
          resolution: { value: new THREE.Vector2(1, 1) },
          rand: { value: 0 },
        },
        vertexShader: backdropVS,
        fragmentShader: backdropFS,
        glslVersion: THREE.GLSL3,
      })
    );
    backdrop.material.side = THREE.BackSide;
    scene.add(backdrop);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(2, -2, 5);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    const geometry = new THREE.IcosahedronGeometry(1, 10);
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x000010,
      metalness: 0.5,
      roughness: 0.1,
      emissive: 0x000010,
      emissiveIntensity: 1.5,
    });

    sphereMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 };
      shader.uniforms.inputData = { value: new THREE.Vector4() };
      shader.uniforms.outputData = { value: new THREE.Vector4() };
      sphereMaterial.userData.shader = shader;
      shader.vertexShader = sphereVS;
    };

    const sphere = new THREE.Mesh(geometry, sphereMaterial);
    scene.add(sphere);
    sphere.visible = false;
    
    new EXRLoader().load('/piz_compressed.exr', (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const exrCubeRenderTarget = pmremGenerator.fromEquirectangular(texture);
      sphereMaterial.envMap = exrCubeRenderTarget.texture;
      sphere.visible = true;
    });

    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 5, 0.5, 0);
    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    let prevTime = performance.now();
    const rotation = new THREE.Vector3(0, 0, 0);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      inputAnalyser.update();
      outputAnalyser.update();

      const t = performance.now();
      const dt = (t - prevTime) / (1000 / 60);
      prevTime = t;

      (backdrop.material as THREE.RawShaderMaterial).uniforms.rand.value = Math.random() * 10000;

      if (sphereMaterial.userData.shader) {
        sphere.scale.setScalar(1 + (0.2 * outputAnalyser.data[1]) / 255);

        const f = 0.001;
        rotation.x += (dt * f * 0.5 * outputAnalyser.data[1]) / 255;
        rotation.z += (dt * f * 0.5 * inputAnalyser.data[1]) / 255;
        rotation.y += (dt * f * 0.25 * inputAnalyser.data[2]) / 255;
        rotation.y += (dt * f * 0.25 * outputAnalyser.data[2]) / 255;

        const euler = new THREE.Euler(rotation.x, rotation.y, rotation.z);
        const quaternion = new THREE.Quaternion().setFromEuler(euler);
        const vector = new THREE.Vector3(0, 0, 5);
        vector.applyQuaternion(quaternion);
        camera.position.copy(vector);
        camera.lookAt(sphere.position);

        sphereMaterial.userData.shader.uniforms.time.value += (dt * 0.1 * outputAnalyser.data[0]) / 255;
        sphereMaterial.userData.shader.uniforms.inputData.value.set(
          (1 * inputAnalyser.data[0]) / 255,
          (0.1 * inputAnalyser.data[1]) / 255,
          (10 * inputAnalyser.data[2]) / 255,
          0
        );
        sphereMaterial.userData.shader.uniforms.outputData.value.set(
          (2 * outputAnalyser.data[0]) / 255,
          (0.1 * outputAnalyser.data[1]) / 255,
          (10 * outputAnalyser.data[2]) / 255,
          0
        );
      }
      composer.render();
    };

    const onWindowResize = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const dPR = renderer.getPixelRatio();
        (backdrop.material as THREE.RawShaderMaterial).uniforms.resolution.value.set(w * dPR, h * dPR);
        renderer.setSize(w, h);
        composer.setSize(w, h);
    };

    window.addEventListener('resize', onWindowResize);
    onWindowResize();
    animate();

    return () => {
      window.removeEventListener('resize', onWindowResize);
      cancelAnimationFrame(animationFrameId);
      pmremGenerator.dispose();
      renderer.dispose();
    };
  }, [inputNode, outputNode]);

  const styles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'absolute',
    inset: 0,
  };

  return <canvas ref={canvasRef} style={styles}></canvas>;
}
