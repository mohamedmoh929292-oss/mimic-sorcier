MIMIC SORCIER - PREMIERE VERSION

1. Installe Node.js si tu ne l'as pas.
2. Ouvre le dossier mimic_sorcier dans ton PC.
3. Dans la barre d'adresse de l'explorateur Windows, écris :
   cmd
4. Dans la fenêtre noire :
   npm install
5. Puis :
   npm start
6. Ouvre :
   http://localhost:3000

Pour tester à plusieurs sur le même PC :
- ouvre plusieurs fenêtres privées / navigateurs
- crée une party
- copie le lien
- ouvre le lien dans les autres fenêtres

AUDIOS
------
Place tes fichiers MP3 ici :
public/audio/

Pour l'instant les noms utilisés dans server.js sont :
ref_001.mp3
ref_002.mp3
ref_003.mp3

Tu peux modifier la liste "references" tout en haut de server.js.

IMPORTANT SUR LA NOTE
---------------------
La logique multijoueur est fonctionnelle, mais la note audio est pour l'instant une
version de test :
- si le navigateur arrive à transcrire ce que dit le joueur, le serveur compare
  les mots avec expectedText ;
- sinon il utilise un score de démonstration.

Pour une vraie note basée sur la ressemblance de la voix, du rythme et de
l'intonation, il faudra brancher ensuite un moteur d'analyse audio côté serveur.