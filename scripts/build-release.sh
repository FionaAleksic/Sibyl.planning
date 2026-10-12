#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf build dist
mkdir -p build/classes build/tests build/stage dist
javac --release 21 -Xlint:all -d build/classes src/main/java/org/sibyl/addons/planning/FairRotation.java
javac --release 21 -Xlint:all -cp build/classes -d build/tests src/test/java/org/sibyl/addons/planning/FairRotationTest.java
java -ea -cp build/classes:build/tests org.sibyl.addons.planning.FairRotationTest
jar --create --file dist/sibyl-planning-0.1.0-rc.1.jar -C build/classes .
cp module.json config.schema.json LICENSE README.md build/stage/
cp dist/sibyl-planning-0.1.0-rc.1.jar build/stage/
(cd build/stage && sha256sum module.json config.schema.json sibyl-planning-0.1.0-rc.1.jar > SHA256SUMS.txt)
(cd build/stage && zip -q -X -r ../../dist/Sibyl.planning-v0.1.0-rc.1.zip .)
python3 - <<'PY'
import zipfile,json,hashlib
p='dist/Sibyl.planning-v0.1.0-rc.1.zip'
with zipfile.ZipFile(p) as z:
 m=json.loads(z.read('module.json'))
 assert m['id']=='Sibyl.planning' and m['version']=='0.1.0-rc.1'
 for line in z.read('SHA256SUMS.txt').decode().splitlines():
  sha,name=line.split(maxsplit=1);assert hashlib.sha256(z.read(name)).hexdigest()==sha
print('Release archive verified')
PY
(cd dist && sha256sum Sibyl.planning-v0.1.0-rc.1.zip > Sibyl.planning-v0.1.0-rc.1.zip.sha256)
echo 'BUILD_OK Sibyl.planning v0.1.0-rc.1'
