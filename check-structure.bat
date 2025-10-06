@echo off
echo === Fixing Kustomize Paths ===

echo 1. Fixing base kustomization...
cd kustomize\base
echo apiVersion: kustomize.config.k8s.io/v1beta1 > kustomization.yaml
echo kind: Kustomization >> kustomization.yaml
echo. >> kustomization.yaml
echo resources: >> kustomization.yaml
echo - ../../infrastructure/namespace.yaml >> kustomization.yaml
echo - ../../infrastructure/mongodb/deployment.yaml >> kustomization.yaml
echo - ../../infrastructure/postgresql/deployment.yaml >> kustomization.yaml
echo - ../../infrastructure/rabbitmq/deployment.yaml >> kustomization.yaml
echo - ../../apps/user-service/deployment.yaml >> kustomization.yaml
echo - ../../apps/email-service/deployment.yaml >> kustomization.yaml
echo - ../../apps/service-registry/deployment.yaml >> kustomization.yaml
echo - ../../apps/api-gateway/deployment.yaml >> kustomization.yaml

echo 2. Fixing overlay kustomization...
cd ..\overlays\local
echo apiVersion: kustomize.config.k8s.io/v1beta1 > kustomization.yaml
echo kind: Kustomization >> kustomization.yaml
echo. >> kustomization.yaml
echo namespace: microservices >> kustomization.yaml
echo. >> kustomization.yaml
echo resources: >> kustomization.yaml
echo - ../../base >> kustomization.yaml
echo. >> kustomization.yaml
echo images: >> kustomization.yaml
echo - name: user-service >> kustomization.yaml
echo   newName: YOUR_DOCKER_USERNAME/user-service >> kustomization.yaml
echo   newTag: latest >> kustomization.yaml
echo - name: email-service >> kustomization.yaml
echo   newName: YOUR_DOCKER_USERNAME/email-service >> kustomization.yaml
echo   newTag: latest >> kustomization.yaml
echo - name: service-registry >> kustomization.yaml
echo   newName: YOUR_DOCKER_USERNAME/service-registry >> kustomization.yaml
echo   newTag: latest >> kustomization.yaml
echo - name: api-gateway >> kustomization.yaml
echo   newName: YOUR_DOCKER_USERNAME/api-gateway >> kustomization.yaml
echo   newTag: latest >> kustomization.yaml

cd ..\..\..
echo 3. Testing kustomize build...
kustomize build kustomize/overlays/local

echo.
echo If no errors, replace YOUR_DOCKER_USERNAME and deploy with:
echo kubectl apply -k kustomize/overlays/local/
pause