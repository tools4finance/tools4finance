#!/usr/bin/env bash
# ============================================================
# tools4finance — Git kurulum scripti
#
# KULLANIM:
# 1. GitHub'da boş bir repo aç (örn: tools4finance), README EKLEME
#    (boş bırak, sonra bu script ekleyecek)
# 2. Bu dosyayı (setup-git.sh) ve tools4finance.zip'i aynı klasöre koy
#    (örn: C:\Users\bhdre\tools4finance klasörünün İÇİNE değil,
#     onun YANINA — masaüstü gibi bir yere)
# 3. VS Code'da Terminal aç, bu klasöre git: cd Desktop  (örnek)
# 4. Çalıştır: bash setup-git.sh
# 5. Script sana GitHub repo URL'ini soracak, yapıştır, Enter
#
# Script şunları yapar:
#   - tools4finance.zip'i açar
#   - git init yapar
#   - GitHub remote'unu bağlar
#   - tüm dosyaları commit edip push eder
# ============================================================

set -e

echo "================================================"
echo "  tools4finance — Git kurulum"
echo "================================================"
echo ""

ZIP_FILE="tools4finance.zip"
TARGET_DIR="tools4finance"

if [ ! -f "$ZIP_FILE" ]; then
  echo "HATA: '$ZIP_FILE' bu klasörde bulunamadı."
  echo "Lütfen tools4finance.zip dosyasını bu script ile aynı klasöre koy."
  exit 1
fi

if [ -d "$TARGET_DIR" ]; then
  echo "UYARI: '$TARGET_DIR' klasörü zaten var."
  read -p "Üzerine yazılsın mı? (e/h): " confirm
  if [ "$confirm" != "e" ]; then
    echo "İptal edildi."
    exit 1
  fi
  rm -rf "$TARGET_DIR"
fi

echo "1/6 — Zip dosyası açılıyor..."
unzip -q "$ZIP_FILE" -d _t4f_temp
mv _t4f_temp/site "$TARGET_DIR"
rm -rf _t4f_temp

cd "$TARGET_DIR"

echo "2/6 — Git deposu başlatılıyor..."
git init -q

echo ""
echo "GitHub'da oluşturduğun BOŞ reponun URL'ini yapıştır."
echo "Örnek: https://github.com/kullaniciadi/tools4finance.git"
read -p "Repo URL: " REPO_URL

if [ -z "$REPO_URL" ]; then
  echo "HATA: URL boş olamaz."
  exit 1
fi

echo "3/6 — GitHub bağlantısı kuruluyor..."
git remote add origin "$REPO_URL"

echo "4/6 — .gitignore oluşturuluyor..."
cat > .gitignore << 'EOF'
.DS_Store
node_modules/
.env
.env.local
*.log
EOF

if ! git config user.email > /dev/null 2>&1; then
  echo ""
  echo "Git kimliğin tanımlı değil, bir defalık ayarlayalım."
  read -p "Adın Soyadın: " GIT_NAME
  read -p "E-posta (info@tools4finance.com olabilir): " GIT_EMAIL
  git config user.name "$GIT_NAME"
  git config user.email "$GIT_EMAIL"
fi

echo "5/6 — Dosyalar commit ediliyor..."
git add .
git commit -q -m "İlk yükleme: tools4finance sitesi"

echo "6/6 — GitHub'a gönderiliyor (push)..."
git branch -M main
git push -u origin main

echo ""
echo "================================================"
echo "  Tamamlandı!"
echo "================================================"
echo "Repo: $REPO_URL"
echo "Klasör: $(pwd)"
echo ""
echo "Sıradaki adım: Vercel'e git, bu GitHub reposunu bağla."
echo "Vercel otomatik olarak siteyi yayınlayacak."
