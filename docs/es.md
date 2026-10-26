# SQL

Convierta sus consultas SQL en sensores de Gladys: el tamaño de una base de
datos, las filas de una tabla de registro, la última medida de una tabla que
llena otra herramienta (una estación meteorológica, un contador de energía, un
script). Las consultas que elija se ejecutan en su base de datos
**PostgreSQL**, **MariaDB** o **MySQL** con el intervalo elegido, y sus
escenas reaccionan cuando la base de datos deja de responder o una consulta
falla. Un widget del panel muestra los valores de un vistazo.

La integración solo lee, y lo comprueba tres veces: rechaza cualquier texto
que no sea un único `SELECT`, cada consulta se ejecuta en una transacción de
solo lectura que impone la propia base de datos, y usted le da un usuario que
solo puede leer.

Probada con servidores reales PostgreSQL 17, MariaDB 11 y MySQL 8 (imágenes
Docker oficiales, tablas reales, un usuario de solo lectura, una base de
datos detenida de verdad). Sus comentarios son bienvenidos:
[github.com/guim31/gladys-sql/issues](https://github.com/guim31/gladys-sql/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Una base de datos PostgreSQL (10 o posterior), MariaDB (10.3 o posterior) o
  MySQL (5.7 o posterior), accesible desde la máquina de Gladys (puerto 5432 o
  3306).
- Un usuario de esta base de datos **que solo pueda leer**. Créelo, como
  administrador de la base de datos:

PostgreSQL:

```sql
CREATE USER gladys PASSWORD 'una contraseña larga';
GRANT CONNECT ON DATABASE casa TO gladys;
GRANT USAGE ON SCHEMA public TO gladys;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gladys;
```

MariaDB y MySQL:

```sql
CREATE USER 'gladys'@'%' IDENTIFIED BY 'una contraseña larga';
GRANT SELECT ON casa.* TO 'gladys'@'%';
```

## Primeros pasos

### 1. Configurar la integración

En Gladys, abra la integración y rellene:

- **Tipo de base de datos**: PostgreSQL, o MariaDB o MySQL.
- **Dirección** del servidor, p. ej. `192.168.1.2`, y su **Puerto** si no es
  el predeterminado (5432 para PostgreSQL, 3306 para MariaDB y MySQL).
- **Base de datos**, **Usuario** y **Contraseña**.
- **Cifrado (TLS)**: **No** en su red local; **Sí, cualquier certificado
  (autofirmado)** para un servidor con su propio certificado; **Sí, con un
  certificado válido** para una base de datos en Internet.
- **Intervalo de actualización**: con qué frecuencia se comprueba la conexión
  y se ejecutan las consultas sin intervalo propio (1 minuto por defecto,
  hasta 1 hora).
- **Tiempo máximo por consulta**: pasado ese tiempo, la base de datos detiene
  la consulta (10 segundos por defecto).
- **Idioma de los mensajes**: de los nombres de funciones, resultados de
  escenas y mensajes.

**Probar la conexión** indica si la base de datos responde, su versión y el
estado de cada consulta.

### 2. Añadir sus consultas

**Añadir una consulta** pide:

- **Nombre**: el nombre de su función en Gladys. El mismo nombre reemplaza la
  consulta.
- **Consulta SQL (SELECT)**: un único `SELECT` o `WITH … SELECT`. El valor se
  lee en la **primera fila**: ordene y limite (`ORDER BY … DESC LIMIT 1`), o
  agregue (`count(*)`, `max()`, `avg()`).
- **Columna (opcional)**: la columna que se lee; vacía, la primera.
- **Tipo**: Número (sin unidad), Temperatura (°C), Humedad (%), Porcentaje
  (%), Potencia (W), Energía (kWh), Tamaño (MB), Texto, o Sí / no (1/0,
  true/false).
- **Intervalo (opcional)**: de 30 segundos a 1 hora; vacío, el intervalo de
  actualización de la configuración.

La consulta se prueba antes de guardarse: el mensaje da su valor, o por qué la
base de datos la rechaza. **Eliminar una consulta** toma su nombre.

Ejemplos:

```sql
-- PostgreSQL: tamaño de la base de datos, en MB (tipo Tamaño)
SELECT pg_database_size(current_database()) / 1000000.0
-- MariaDB, MySQL: tamaño de la base de datos, en MB (tipo Tamaño)
SELECT SUM(data_length + index_length) / 1000000 FROM information_schema.tables WHERE table_schema = DATABASE()
-- Filas añadidas hoy (tipo Número)
SELECT count(*) FROM eventos WHERE creado >= CURRENT_DATE
-- Última temperatura de una tabla de medidas (tipo Temperatura)
SELECT temperatura FROM medidas ORDER BY creado DESC LIMIT 1
-- ¿Funcionó la copia de seguridad de anoche? (tipo Sí / no)
SELECT ok FROM copias ORDER BY fin DESC LIMIT 1
```

### 3. Añadir el dispositivo

En la pestaña **Descubrir**, añada la base de datos. Después de añadir o
eliminar consultas, pulse allí **Actualizar** en ella: Gladys añade las nuevas
funciones.

## Los dispositivos

Un dispositivo para la base de datos, con su nombre (p. ej. `PostgreSQL
casa`):

- **Accesible**: 1 mientras la base de datos responde, 0 si no.
- **Versión**: la versión del servidor, p. ej. `PostgreSQL 17.6`,
  `MariaDB 11.4.3`.
- Una función por consulta, de su tipo. Una fila ausente, o un valor `NULL`,
  deja el último valor.

La insignia del dispositivo pasa a «inaccesible» mientras la base de datos no
responde.

## Panel

El widget **Valores SQL** muestra la base de datos (su versión, o por qué no
responde) y después el último valor de cada consulta: diez filas como máximo.
**Actualizar** vuelve a leerlo todo ahora.

## Escenas

### Disparadores

- **La base de datos es inaccesible**: dos lecturas seguidas fallan (sin
  respuesta, acceso denegado, base de datos no encontrada, TLS rechazado).
  Variables: el error y su clave (`unreachable`, `auth`, `database`, `tls`).
- **La base de datos responde de nuevo**: después de una caída anunciada;
  variable: su duración en minutos.
- **Una consulta falla**: un error en la consulta, el tiempo máximo
  alcanzado, o un valor que no encaja con su tipo. Una vez, hasta que vuelva a
  funcionar. Filtro: el nombre de la consulta (vacío: todas).
- **Una consulta vuelve a funcionar**: la consulta vuelve a dar un valor;
  variable: el valor.

Ninguna fila no es un fallo: una consulta cuyo resultado está vacío por ahora
no dispara nada.

### Acciones

**Leer una consulta SQL ahora** ejecuta una consulta guardada (indique su
nombre) o un `SELECT` (leído en su primera columna), y da **value** (un
número, 0 si el valor no lo es) y **text** (el valor con su unidad, o el
texto). Una escena puede usarlos en un mensaje o una condición.

### Ideas de escenas

- Cada mañana, enviar «{{text}} filas añadidas al registro ayer», leído con
  **Leer una consulta SQL ahora**.
- **La base de datos es inaccesible**: enviar un mensaje con el error, y
  encender una luz en rojo hasta **La base de datos responde de nuevo**.
- Cuando la función «Copia ok» vale 0 a las 8:00, enviar un recordatorio para
  comprobar la copia de seguridad.

## Solución de problemas

- **«no responde»**: compruebe la dirección y el puerto, y que el servidor
  escucha en la red (`listen_addresses` en PostgreSQL, `bind-address` en
  MariaDB y MySQL) y acepta la máquina de Gladys (`pg_hba.conf` en
  PostgreSQL).
- **«acceso denegado»**: compruebe el usuario y la contraseña; con MariaDB o
  MySQL, el usuario debe estar permitido desde la dirección de la máquina de
  Gladys (`'gladys'@'%'`).
- **«base de datos no encontrada»**: compruebe su nombre (y, con MariaDB o
  MySQL, que el usuario tiene un permiso sobre ella).
- **«TLS rechazado»**: cambie **Cifrado (TLS)**: el servidor no lo ofrece, lo
  exige, o su certificado no es válido.
- **«solo se acepta SELECT (o WITH … SELECT)»**, **«esta palabra escribe o
  bloquea»**: la integración rechaza lo que podría escribir (`INSERT`,
  `UPDATE`, `DELETE`, `SELECT … INTO`, `FOR UPDATE`, `nextval()`…). Ponga
  entre comillas una columna con ese nombre (`"update"` en PostgreSQL,
  `` `update` `` en MySQL).
- **«rechazada por la base de datos: escribiría»**: la consulta llama a una
  función que escribe; la transacción de solo lectura la detuvo.
- **«demasiado lenta»**: añada un índice, acote la consulta (`WHERE creado >
now() - interval '1 day'`), o aumente el tiempo máximo.
- **Registros**: en Gladys, la página de la integración muestra sus registros.
  Añada `LOG_LEVEL=debug` para ver cada lectura.

## Límites

- Una base de datos por instalación, 20 consultas; un valor por consulta (la
  primera fila).
- Solo lectura: nunca se escribe nada en la base de datos. Se rechaza una
  barra invertida (`\`) en una consulta: su sentido depende de los ajustes del
  servidor.
- Solo PostgreSQL, MariaDB y MySQL (ni SQL Server, ni Oracle, ni SQLite).
- Las consultas se guardan en el volumen de datos de la integración:
  reinstalarla desde cero las pierde (añádalas de nuevo con los mismos
  nombres: mismas funciones).
- Los números se redondean a dos decimales, los textos se cortan a 250
  caracteres.
- Probada con las herramientas de prueba del SDK de Gladys y servidores reales
  de bases de datos, aún no en una instancia real de Gladys: sus comentarios
  son bienvenidos.
