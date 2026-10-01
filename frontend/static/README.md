# Manual Corporativo - Sistema de Diseño MirAI

Sistema de diseño unificado para las marcas del grupo: **Provefrut**, **Procongelados** y **Nintanga**.

Proporciona una base visual consistente, tematizable y responsive para todos los proyectos internos del grupo corporativo.

## Estructura

```
├── MiraiCorporativo/          # Sistema de diseño modular
│   ├── mirai-base.css         # Reset, variables, temas, tipografía
│   ├── mirai-componentes.css  # Botones, cards, badges, tablas, formularios
│   ├── mirai-layout.css       # Header, nav, drawer, dashboard, sidebar mobile
│   ├── mirai-responsive.css   # Breakpoints, utilidades flex/grid, animaciones
│   ├── plantilla.html         # Plantilla base con todos los componentes
│   └── guia-desarrollo.html   # Guía de referencia para desarrolladores
├── boxicons/                  # Librería de iconos (css + fonts)
├── manual-corporativo.css     # CSS del manual de marca (variables globales)
├── LogoProvefrut.png          # Logo Provefrut
├── LogoProcongelados.png      # Logo Procongelados
├── LogoNintanga.png           # Logo Nintanga
├── Mirai1-provefrut.png       # Screenshot tema Provefrut
├── Mirai1-procongelados.png   # Screenshot tema Procongelados
└── Mirai1-nintanga.png        # Screenshot tema Nintanga
```

## Temas disponibles

El sistema soporta 3 temas que se activan con una clase CSS en el `<html>`:

| Tema | Clase | Color primario | Color acento |
|------|-------|---------------|-------------|
| Provefrut | `provefrut-theme` | `#285d2f` (verde) | `#78b21f` (verde brillante) |
| Procongelados | `procongelados-theme` | `#2e247a` (azul navy) | `#019ee3` (azul brillante) |
| Nintanga | `nintanga-theme` | `#712d7d` (púrpura) | `#ea64a5` (rosa) |

## Uso rápido

```html
<!DOCTYPE html>
<html lang="es" class="provefrut-theme">
<head>
    <link rel="stylesheet" href="MiraiCorporativo/mirai-base.css">
    <link rel="stylesheet" href="MiraiCorporativo/mirai-componentes.css">
    <link rel="stylesheet" href="MiraiCorporativo/mirai-layout.css">
    <link rel="stylesheet" href="MiraiCorporativo/mirai-responsive.css">
    <link rel="stylesheet" href="boxicons/css/boxicons.min.css">
</head>
<body>
    <div class="app-shell">
        <!-- header, nav, main -->
    </div>
</body>
</html>
```

Para cambiar de tema dinámicamente:

```javascript
document.documentElement.className = 'procongelados-theme';
```

## Componentes incluidos

- Header con logo, fecha/hora, usuario y logout
- Navegación desktop con submenús + sidebar mobile con hamburguesa
- Page header con título, subtítulo y acciones
- Filtros y buscador
- Tablas con columnas ocultables por breakpoint
- Cards (primario, header oscuro, borde izquierdo)
- Badges de estado (activo, pendiente, aprobado, rechazado, etc.)
- Formularios con inputs, selects, textareas, checkboxes
- Drawers laterales (derecho e izquierdo)
- Alertas (success, danger, warning, info)
- Timeline / historial
- Stepper de proceso
- Dashboard con stats grid
- Botones (primario, acento, éxito, peligro, outline, iconos)
- Tags y badge pills

## Referencia

Abrir `MiraiCorporativo/plantilla.html` en el navegador para ver todos los componentes en acción con cambio de tema en vivo.
