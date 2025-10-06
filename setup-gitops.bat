@echo off
echo === Setting up GitOps ===

echo 1. Installing ArgoCD...
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

echo 2. Waiting for ArgoCD to be ready...
timeout /t 60
kubectl get pods -n argocd

echo 3. Port forwarding ArgoCD UI...
echo ArgoCD will be available at: https://localhost:8080
kubectl port-forward -n argocd svc/argocd-server 8080:443

echo 4. Get initial password:
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d