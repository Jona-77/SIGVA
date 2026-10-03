# Contribución

## Flujo de trabajo

1. Crear una rama desde `main` para cada cambio.
2. Realizar cambios en la rama de trabajo.
3. Ejecutar pruebas locales con `npm --prefix backend run test` y `npm --prefix frontend run build`.
4. Crear un pull request hacia `main`.
5. Esperar la aprobación de al menos otra persona del equipo.
6. Verificar que el CI pasa antes del merge.

## Reglas

- No se hacen commits directos a `main`.
- Los cambios deben incluir pruebas cuando aplique.
- En caso de modificar la base de datos, ejecutar `npm --prefix backend run db:reset` para validar el seed completo.
- No incluir secretos reales en archivos `.env` ni en el repositorio.

## Protección de rama

Para proteger la rama principal:

1. Ir a GitHub > Settings > Branches.
2. Agregar regla para `main`.
3. Marcar:
   - Require pull request before merging
   - Require approvals: 1
   - Require status checks to pass before merging
   - Seleccionar el workflow `CI`
