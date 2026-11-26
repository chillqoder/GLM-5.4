async page => {
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(2500);
  const res = await page.evaluate(async () => {
    const T = window.ork.THREE, r = window.ork.rig, RQ = window.ork.restQuat;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // analytic 2-bone IK: returns Euler offsets for arm/forearm (+ hand when gripping the staff)
    const solve = (side, targetW, poleLocal, grip) => {
      const arm = r[side + 'Arm'], fore = r[side + 'Forearm'], hand = r[side + 'Hand'];
      const S = arm.getWorldPosition(new T.Vector3());
      const parentQ = arm.parent.getWorldQuaternion(new T.Quaternion());
      const L1 = 0.42, L2 = 0.5;
      const toT = targetW.clone().sub(S); const need = toT.length(); const d = Math.min(need, L1 + L2 - 0.01); const dir = toT.normalize();
      const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
      const cosF = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
      const a = -Math.acos(cosF);
      const pole = poleLocal.clone().applyQuaternion(r.shaman.quaternion);
      const polePerp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
      const axis = new T.Vector3().crossVectors(dir, polePerp).normalize();
      const u = dir.clone().applyAxisAngle(axis, Math.acos(cosA));
      const z = polePerp.clone().negate(); z.addScaledVector(u, -z.dot(u)).normalize();
      const y = u.clone().negate();
      const x = new T.Vector3().crossVectors(y, z);
      const qUpperW = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
      const qUpperLocal = parentQ.clone().invert().multiply(qUpperW);
      const eUpper = new T.Euler().setFromQuaternion(RQ[side + 'Arm'].clone().invert().multiply(qUpperLocal), 'XYZ');
      const qFore = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), a);
      const eFore = new T.Euler().setFromQuaternion(RQ[side + 'Forearm'].clone().invert().multiply(qFore), 'XYZ');
      let eHand = null;
      if (grip) {
        const foreW = qUpperW.clone().multiply(qFore);
        const hy = grip.up.clone(), hz = grip.normal.clone(), hx = new T.Vector3().crossVectors(hy, hz);
        const qHandW = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(hx, hy, hz));
        eHand = new T.Euler().setFromQuaternion(foreW.clone().invert().multiply(qHandW), 'XYZ');
      }
      // apply so subsequent solves see the new pose
      arm.quaternion.copy(RQ[side + 'Arm']); arm.rotateX(eUpper.x); arm.rotateY(eUpper.y); arm.rotateZ(eUpper.z);
      fore.quaternion.copy(RQ[side + 'Forearm']); fore.rotateX(eFore.x); fore.rotateY(eFore.y); fore.rotateZ(eFore.z);
      r.shaman.updateMatrixWorld(true);
      const f = v => v.map(k => +k.toFixed(2));
      return { need: +need.toFixed(3), arm: f([eUpper.x, eUpper.y, eUpper.z]), fore: f([eFore.x, eFore.y, eFore.z]), hand: eHand && f([eHand.x, eHand.y, eHand.z]) };
    };
    const alignStaff = (x) => { const q = new T.Quaternion().copy(r.torso.quaternion).multiply(r.rArm.quaternion).multiply(r.rForearm.quaternion).multiply(r.rHand.quaternion).invert(); r.staff.quaternion.copy(q); r.staff.rotateX(x); r.shaman.updateMatrixWorld(true); };
    const toWorld = (x, y, z) => r.shaman.localToWorld(new T.Vector3(x, y, z));
    const gripLeft = (h) => {
      const staffQ = r.staff.getWorldQuaternion(new T.Quaternion());
      const up = new T.Vector3(0, 1, 0).applyQuaternion(staffQ);
      const rightHand = r.staff.getWorldPosition(new T.Vector3());
      const S = r.lArm.getWorldPosition(new T.Vector3());
      const n = rightHand.clone().sub(S); n.addScaledVector(up, -n.dot(up)); n.normalize();
      const target = rightHand.clone().addScaledVector(up, h).addScaledVector(n, -0.07);
      return { target, up, normal: n };
    };
    const out = {};
    // ---- LIFT (t = 0.55): staff vertical in front of the chest, both hands on the shaft
    window.ork.freeze('earthquake', 0.55); await frame();
    out.liftRight = solve('r', toWorld(-0.1, 0.98, 0.72), new T.Vector3(-1, -0.6, 0.3));
    alignStaff(0.08);
    let g = gripLeft(0.4);
    out.liftLeft = solve('l', g.target, new T.Vector3(0.9, -1, 0.2), g);
    // ---- SLAM (t = 0.72): staff base on the ground ahead, both hands low on the shaft
    window.ork.freeze('earthquake', 0.72); await frame();
    const base = r.staff.localToWorld(new T.Vector3(0, -0.9, 0));
    out.slamBase = [base.x, base.y, base.z].map(k => +k.toFixed(3));
    out.slamRightRest = r.staff.getWorldPosition(new T.Vector3()).toArray().map(k => +k.toFixed(3));
    out.slamRight = solve('r', toWorld(-0.1, 0.6, 0.75), new T.Vector3(-1, -0.8, 0.2));
    alignStaff(-0.87);
    g = gripLeft(0.35);
    out.slamLeft = solve('l', g.target, new T.Vector3(1, -0.8, 0.1), g);
    const b2 = r.staff.localToWorld(new T.Vector3(0, -0.9, 0));
    out.slamBase2 = [b2.x, b2.y, b2.z].map(k => +k.toFixed(3));
    const hw = r.staff.getWorldPosition(new T.Vector3()); const hq = r.staff.getWorldQuaternion(new T.Quaternion());
    out.slamHand = hw.toArray().map(k => +k.toFixed(3)); out.slamUp = new T.Vector3(0, 1, 0).applyQuaternion(hq).toArray().map(k => +k.toFixed(3));
    out.slamTarget = toWorld(-0.1, 0.6, 0.75).toArray().map(k => +k.toFixed(3));
    return out;
  });
  return JSON.stringify(res);
}
