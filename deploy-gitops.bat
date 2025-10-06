@echo off
echo === Deploying via GitOps ===

echo 1. Applying ArgoCD applications...
kubectl apply -f argocd/app-of-apps.yaml
kubectl apply -f argocd/microservices-app.yaml

echo 2. Checking sync status...
argocd app list

echo 3. Manual sync if needed...
argocd app sync microservices

echo 4. Watch deployment...
kubectl get pods -n microservices --watch