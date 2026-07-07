'use strict';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyANhsUB1pQA1xJ7Hgswm0SCPGCXYej3NAI',
  authDomain: 'elturco-92488.firebaseapp.com',
  projectId: 'elturco-92488',
  storageBucket: 'elturco-92488.firebasestorage.app',
  messagingSenderId: '909805366642',
  appId: '1:909805366642:web:7ee9d528fde389fea581eb',
};

function isFirebaseConfigured() {
  return (
    typeof window.firebase !== 'undefined' &&
    !FIREBASE_CONFIG.apiKey.startsWith('TU_') &&
    !FIREBASE_CONFIG.projectId.startsWith('TU-PROYECTO')
  );
}

if (isFirebaseConfigured() && !window.firebase.apps.length) {
  window.firebase.initializeApp(FIREBASE_CONFIG);
}
