import { mkdir, rm } from "fs/promises";
import { createUnityPackage, extractUnityPackage } from "./index";

(async () => {
  await rm("./test/output", { recursive: true, force: true });
  await mkdir("./test/output", { recursive: true });

  console.log("Creating unity package");
  await createUnityPackage(
    "./test",
    "Assets/Test Folder",
    "./test/out.unitypackage"
  );

  console.log("Extracting unity package");
  await extractUnityPackage("./test/out.unitypackage", "./test/output", true);

  console.log("Done");
})();
