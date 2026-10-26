# SQL

Transformez vos requêtes SQL en capteurs Gladys : la taille d'une base, les
lignes d'une table de journal, la dernière mesure d'une table remplie par un
autre outil (une station météo, un compteur d'énergie, un script). Les
requêtes que vous choisissez s'exécutent sur votre base **PostgreSQL**,
**MariaDB** ou **MySQL** à l'intervalle choisi, et vos scènes réagissent quand
la base ne répond plus ou qu'une requête échoue. Un widget du tableau de bord
montre les valeurs d'un coup d'œil.

L'intégration ne fait que lire, et le vérifie trois fois : elle refuse tout
texte qui n'est pas un seul `SELECT`, chaque requête s'exécute dans une
transaction en lecture seule imposée par la base elle-même, et vous lui donnez
un utilisateur qui ne peut que lire.

Testée contre de vrais serveurs PostgreSQL 17, MariaDB 11 et MySQL 8 (images
Docker officielles, vraies tables, utilisateur en lecture seule, base coupée
pour de vrai). Vos retours sont les bienvenus :
[github.com/guim31/gladys-sql/issues](https://github.com/guim31/gladys-sql/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Une base PostgreSQL (10 ou plus récent), MariaDB (10.3 ou plus récent) ou
  MySQL (5.7 ou plus récent), joignable depuis la machine Gladys (port 5432 ou
  3306).
- Un utilisateur de cette base **qui ne peut que lire**. Créez-le, en
  administrateur de la base :

PostgreSQL :

```sql
CREATE USER gladys PASSWORD 'un long mot de passe';
GRANT CONNECT ON DATABASE maison TO gladys;
GRANT USAGE ON SCHEMA public TO gladys;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gladys;
```

MariaDB et MySQL :

```sql
CREATE USER 'gladys'@'%' IDENTIFIED BY 'un long mot de passe';
GRANT SELECT ON maison.* TO 'gladys'@'%';
```

## Premiers pas

### 1. Configurer l'intégration

Dans Gladys, ouvrez l'intégration et renseignez :

- **Type de base** : PostgreSQL, ou MariaDB ou MySQL.
- **Adresse** du serveur, ex. `192.168.1.2`, et son **Port** s'il n'est pas
  celui par défaut (5432 pour PostgreSQL, 3306 pour MariaDB et MySQL).
- **Base de données**, **Utilisateur** et **Mot de passe**.
- **Chiffrement (TLS)** : **Non** sur votre réseau local ; **Oui, tout
  certificat (auto-signé)** pour un serveur à son propre certificat ; **Oui,
  avec un certificat valide** pour une base sur Internet.
- **Intervalle de rafraîchissement** : à quelle fréquence la connexion est
  vérifiée et les requêtes sans intervalle propre s'exécutent (1 minute par
  défaut, jusqu'à 1 heure).
- **Délai maximal par requête** : au-delà, la base arrête la requête (10
  secondes par défaut).
- **Langue des messages** : des noms de fonctionnalités, des résultats de scène
  et des messages.

**Tester la connexion** dit si la base répond, sa version, et l'état de chaque
requête.

### 2. Ajouter vos requêtes

**Ajouter une requête** demande :

- **Nom** : le nom de sa fonctionnalité dans Gladys. Le même nom remplace la
  requête.
- **Requête SQL (SELECT)** : un seul `SELECT` ou `WITH … SELECT`. La valeur
  est lue dans la **première ligne** : triez et limitez (`ORDER BY … DESC
LIMIT 1`), ou agrégez (`count(*)`, `max()`, `avg()`).
- **Colonne (facultatif)** : la colonne à lire ; vide, la première.
- **Type** : Nombre (sans unité), Température (°C), Humidité (%), Pourcentage
  (%), Puissance (W), Énergie (kWh), Taille (Mo), Texte, ou Oui / non (1/0,
  true/false).
- **Intervalle (facultatif)** : de 30 secondes à 1 heure ; vide,
  l'intervalle de rafraîchissement de la configuration.

La requête est essayée avant d'être enregistrée : le message donne sa valeur,
ou pourquoi la base la refuse. **Supprimer une requête** prend son nom.

Exemples :

```sql
-- PostgreSQL : taille de la base, en Mo (type Taille)
SELECT pg_database_size(current_database()) / 1000000.0
-- MariaDB, MySQL : taille de la base, en Mo (type Taille)
SELECT SUM(data_length + index_length) / 1000000 FROM information_schema.tables WHERE table_schema = DATABASE()
-- Lignes ajoutées aujourd'hui (type Nombre)
SELECT count(*) FROM evenements WHERE cree_le >= CURRENT_DATE
-- Dernière température d'une table de mesures (type Température)
SELECT temperature FROM mesures ORDER BY cree_le DESC LIMIT 1
-- La sauvegarde de cette nuit a-t-elle marché ? (type Oui / non)
SELECT ok FROM sauvegardes ORDER BY fin DESC LIMIT 1
```

### 3. Ajouter l'appareil

Dans l'onglet **Découverte**, ajoutez la base. Après avoir ajouté ou supprimé
des requêtes, cliquez sur **Mettre à jour** sur elle : Gladys ajoute les
nouvelles fonctionnalités.

## Les appareils

Un appareil pour la base, à son nom (ex. `PostgreSQL maison`) :

- **Joignable** : 1 tant que la base répond, 0 sinon.
- **Version** : la version du serveur, ex. `PostgreSQL 17.6`, `MariaDB 11.4.3`.
- Une fonctionnalité par requête, de son type. Une ligne absente, ou une
  valeur `NULL`, laisse la dernière valeur en place.

Le badge de l'appareil passe à « injoignable » tant que la base ne répond pas.

## Tableau de bord

Le widget **Valeurs SQL** montre la base (sa version, ou pourquoi elle ne
répond pas), puis la dernière valeur de chaque requête : dix lignes au plus.
**Actualiser** relit tout maintenant.

## Scènes

### Déclencheurs

- **La base est injoignable** : deux lectures de suite échouent (pas de
  réponse, accès refusé, base introuvable, TLS refusé). Variables : l'erreur,
  et sa clé (`unreachable`, `auth`, `database`, `tls`).
- **La base répond de nouveau** : après une panne annoncée ; variable : sa
  durée en minutes.
- **Une requête échoue** : une erreur dans la requête, le délai maximal
  atteint, ou une valeur qui ne va pas avec son type. Une fois, jusqu'à ce
  qu'elle remarche. Filtre : le nom de la requête (vide : toutes).
- **Une requête remarche** : la requête donne de nouveau une valeur ;
  variable : la valeur.

Aucune ligne n'est pas un échec : une requête dont le résultat est vide pour
le moment ne déclenche rien.

### Actions

**Lire une requête SQL maintenant** exécute une requête enregistrée (donnez
son nom) ou un `SELECT` (lu dans sa première colonne), et donne **value** (un
nombre, 0 si la valeur n'en est pas un) et **text** (la valeur avec son unité,
ou le texte). Une scène peut s'en servir dans un message ou une condition.

### Idées de scènes

- Chaque matin, envoyer « {{text}} lignes ajoutées au journal hier », lu par
  **Lire une requête SQL maintenant**.
- **La base est injoignable** : envoyer un message avec l'erreur, et allumer
  une lampe en rouge jusqu'à **La base répond de nouveau**.
- Quand la fonctionnalité « Sauvegarde ok » vaut 0 à 8 h, envoyer un rappel
  pour vérifier la sauvegarde.

## Dépannage

- **« ne répond pas »** : vérifiez l'adresse et le port, et que le serveur
  écoute sur le réseau (`listen_addresses` dans PostgreSQL, `bind-address`
  dans MariaDB et MySQL) et accepte la machine Gladys (`pg_hba.conf` dans
  PostgreSQL).
- **« accès refusé »** : vérifiez l'utilisateur et le mot de passe ; avec
  MariaDB ou MySQL, l'utilisateur doit être autorisé depuis l'adresse de la
  machine Gladys (`'gladys'@'%'`).
- **« base de données introuvable »** : vérifiez son nom (et, avec MariaDB ou
  MySQL, que l'utilisateur a un droit dessus).
- **« TLS refusé »** : changez **Chiffrement (TLS)** : le serveur ne le
  propose pas, l'exige, ou son certificat n'est pas valide.
- **« seul SELECT (ou WITH … SELECT) est accepté »**, **« ce mot écrit ou
  verrouille »** : l'intégration refuse ce qui pourrait écrire (`INSERT`,
  `UPDATE`, `DELETE`, `SELECT … INTO`, `FOR UPDATE`, `nextval()`…). Mettez
  entre guillemets une colonne qui porte un tel nom (`"update"` dans
  PostgreSQL, `` `update` `` dans MySQL).
- **« refusée par la base : elle écrirait »** : la requête appelle une
  fonction qui écrit ; la transaction en lecture seule l'a arrêtée.
- **« trop lente »** : ajoutez un index, bornez la requête (`WHERE cree_le >
now() - interval '1 day'`), ou augmentez le délai maximal.
- **Logs** : dans Gladys, la page de l'intégration montre ses logs. Ajoutez
  `LOG_LEVEL=debug` pour voir chaque lecture.

## Limites

- Une base par installation, 20 requêtes ; une valeur par requête (la
  première ligne).
- Lecture seule : rien n'est jamais écrit dans la base.
- PostgreSQL, MariaDB et MySQL seulement (ni SQL Server, ni Oracle, ni
  SQLite).
- Les requêtes sont gardées dans le volume de données de l'intégration : la
  réinstaller de zéro les perd (ajoutez-les de nouveau sous les mêmes noms :
  mêmes fonctionnalités).
- Les nombres sont arrondis à deux décimales, les textes coupés à 250
  caractères.
- Testée avec les outils de test du SDK de Gladys et de vrais serveurs de
  bases de données, pas encore dans une vraie instance Gladys : vos retours
  sont les bienvenus.
