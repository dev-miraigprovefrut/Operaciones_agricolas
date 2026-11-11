# Tractor Nintanga (APK para la tablet del tractor)

Reemplaza al kiosko de la Raspberry. Es la app de tractoristas de Operaciones
Agrícolas empaquetada con Capacitor 7, en **modo tablet**:

- La tablet se vincula UNA vez a un tractor con el código de 6 dígitos de
  Catálogos › Tractoristas › Tablets de tractor.
- Varios tractoristas entran en ella con su usuario y código de 4 dígitos;
  sin internet entran contra la huella guardada en la tablet.
- El tractor queda fijo en la bitácora.
- Telemetría cada minuto: GPS + horas de motor (tablet CARGANDO = motor
  encendido; va conectada al cargador del tractor). Sin internet se guarda y
  se envía al volver la señal, con su hora real.

## Publicar una version nueva (firmada)

Con `aws sso login --profile mirai-dev` hecho, desde esta carpeta:

    .\publicar.ps1 -Notas "que cambio"              # compila, firma y publica
    .\publicar.ps1 -Notas "prueba" -SoloCompilar     # firma pero no publica

- La clave de firma esta SOLO en Secrets Manager (`operacionesagricolas/apk-firma`).
  Si se pierde, las tablets no aceptan actualizaciones: hay que desinstalar en cada una.
- El APK y `version.json` quedan en `s3://operacionesagricolas/apk/`.
- Las tablets ven la version nueva al abrir la app con señal (boton "Actualizar").

## Instalar en una tablet (solo la primera vez)

1. En la tablet abrir https://operacionesabk.miraigprovefrut.com/api/app-tablet/descargar
2. Abrir el APK descargado y permitir "instalar apps de origen desconocido".
3. Permitir ubicacion, elegir el equipo y escribir las horas del horometro.
4. Dejarla conectada al cargador del tractor (cargando = motor encendido: suma horas).