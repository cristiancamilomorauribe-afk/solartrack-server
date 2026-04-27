/**
 * background.js — Tarea en segundo plano (Capacitor Background Runner)
 *
 * Se ejecuta cada 1 minuto aunque la app esté cerrada.
 * Guarda la ubicación GPS y la envía al maestro.
 *
 * Ref: https://capacitorjs.com/docs/apis/background-runner
 */
addEventListener('locationSync', async (resolve, reject, args) => {
  try {
    // Obtener posición GPS
    const position = await CapacitorGeolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
    });

    const { latitude: lat, longitude: lng, accuracy } = position.coords;

    // Leer perfil del trabajador desde storage local
    const profileRaw = await CapacitorKV.get('workerProfile');
    if (!profileRaw?.value) return resolve();

    const profile = JSON.parse(profileRaw.value);

    const record = {
      workerId:   profile.id,
      workerName: profile.name,
      parkId:     profile.parkId,
      zoneId:     profile.zoneId,
      lat,
      lng,
      accuracy,
      ts:    new Date().toISOString(),
      date:  new Date().toISOString().slice(0, 10),
    };

    // Intentar enviar al maestro WiFi local
    try {
      await fetch(`http://${profile.masterIp}:8080/location`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(record),
      });
    } catch (_) {
      // Guardar en cola offline
      const queueRaw = await CapacitorKV.get('offlineQueue');
      const queue = queueRaw?.value ? JSON.parse(queueRaw.value) : [];
      queue.push(record);
      // Mantener máximo 1000 puntos en cola (evita exceder storage)
      if (queue.length > 1000) queue.splice(0, queue.length - 1000);
      await CapacitorKV.set('offlineQueue', JSON.stringify(queue));
    }

    resolve();
  } catch (err) {
    reject(err.message);
  }
});
